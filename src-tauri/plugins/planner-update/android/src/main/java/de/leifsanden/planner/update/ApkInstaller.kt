package de.leifsanden.planner.update

import android.content.Context
import android.content.pm.PackageInstaller
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Laedt das APK und gibt es dem System zum Einspielen.
 *
 * Der Weg fuehrt ueber die Session-API des PackageInstaller und nicht ueber
 * einen ACTION_VIEW-Intent auf eine Datei. Das hat drei Gruende:
 *
 *  - Die Bytes gehen direkt aus der Netzverbindung in die Sitzung. Es entsteht
 *    keine Datei auf der Platte, die man anlegen, aufraeumen und im Fehlerfall
 *    trotzdem zurueckstellen muesste. Bei rund 40 MB ist das kein Detail.
 *  - Es braucht keinen FileProvider. Der waere sonst noetig, um eine
 *    content://-Adresse fuer die Datei zu erzeugen - mit eigenem Eintrag im
 *    Manifest und einer XML-Datei mit Pfadfreigaben.
 *  - Es gibt eine Rueckmeldung. Der Intent-Weg endet im Nichts: Die App
 *    erfaehrt nie, ob installiert oder abgebrochen wurde.
 */
object ApkInstaller {

    /**
     * Dasselbe Manifest, das der Desktop-Updater liest - siehe
     * `plugins.updater.endpoints` in tauri.conf.json. Der Android-Eintrag
     * darin kommt aus der CI (scripts/android-latest-json.mjs).
     *
     * Die Adresse steht hier fest und wird nicht von aussen hereingereicht:
     * Ein Befehl, der eine beliebige Adresse abruft, machte die App zum
     * Botenjungen fuer alles, was in der WebView schiefgehen kann.
     */
    private const val MANIFEST_URL =
        "https://github.com/sandenleif/planner/releases/latest/download/latest.json"

    /**
     * Nur was hierunter liegt, wird geladen. Muss zu ASSET_PREFIX in
     * ../src/lib.rs passen.
     */
    private const val ASSET_PREFIX =
        "https://github.com/sandenleif/planner/releases/download/"

    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val BUFFER = 64 * 1024

    /** Der Name ist frei waehlbar und nur innerhalb der Sitzung sichtbar. */
    private const val ENTRY = "planner.apk"

    // ------------------------------------------------------------- Manifest

    /** Blockiert - der Aufrufer sorgt fuer einen eigenen Thread. */
    fun manifest(): String {
        val connection = open(MANIFEST_URL)
        try {
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    // ----------------------------------------------------------- Einspielen

    /**
     * Startet Laden und Installieren im Hintergrund und kehrt sofort zurueck.
     * Der Fortschritt steht in [UpdateState].
     */
    fun start(context: Context, url: String) {
        if (!url.startsWith(ASSET_PREFIX)) {
            UpdateState.fail("Abgelehnte Adresse: $url")
            return
        }

        // Zwei Ladevorgaenge nebeneinander waeren zwei Sitzungen auf dasselbe
        // Paket - die zweite verdraengte die erste, und der Fortschritt zaehlte
        // durcheinander.
        synchronized(this) {
            if (UpdateState.busy()) return
            UpdateState.begin()
        }

        // Ein einfacher Thread statt eines WorkManager-Auftrags: Der Vorgang
        // endet ohnehin damit, dass ein Dialog im Vordergrund erscheint. Etwas,
        // das den Prozesstod ueberlebt, waere hier ohne Zweck.
        thread(name = "planner-update", isDaemon = true) {
            runInstall(context.applicationContext, url)
        }
    }

    private fun runInstall(context: Context, url: String) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL,
        )

        // Ohne diese Angabe koennte die Sitzung ein beliebiges Paket meinen.
        // Mit ihr lehnt das System frueh ab, falls das geladene APK ein anderes
        // ist als erwartet.
        params.setAppPackageName(context.packageName)

        var sessionId = -1
        var committed = false

        try {
            val connection = open(url)
            try {
                val length = connection.contentLengthLong
                if (length > 0) {
                    UpdateState.total.set(length)
                    // Erlaubt dem System, den Platz vorab zu pruefen und zu
                    // reservieren, statt bei 95 Prozent aufzugeben.
                    params.setSize(length)
                }

                sessionId = installer.createSession(params)

                installer.openSession(sessionId).use { session ->
                    connection.inputStream.use { input ->
                        session.openWrite(ENTRY, 0, if (length > 0) length else -1L)
                            .use { output ->
                                copy(input, output)
                                // Ohne fsync koennen Bytes im Puffer stehen
                                // bleiben, und das System sieht ein
                                // unvollstaendiges Paket.
                                session.fsync(output)
                            }
                    }

                    UpdateState.state = UpdateState.INSTALLING
                    session.commit(InstallResultReceiver.sender(context))
                    committed = true
                }
            } finally {
                connection.disconnect()
            }
        } catch (error: Throwable) {
            // Eine nicht uebergebene Sitzung belegt Platz, bis das System sie
            // irgendwann selbst aufraeumt.
            if (sessionId >= 0 && !committed) {
                runCatching { installer.abandonSession(sessionId) }
            }
            UpdateState.fail(describe(error))
        }
    }

    private fun copy(input: InputStream, output: OutputStream) {
        val buffer = ByteArray(BUFFER)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            UpdateState.bytes.addAndGet(read.toLong())
        }
    }

    // ----------------------------------------------------------------- Netz

    private fun open(url: String): HttpURLConnection {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            // GitHub verweist von der Release-Adresse auf einen
            // Auslieferungsserver weiter - ohne Folgen der Weiterleitung kaeme
            // hier nur die Weiterleitung selbst an.
            instanceFollowRedirects = true
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Accept", "application/octet-stream")
        }

        connection.connect()

        if (connection.responseCode !in 200..299) {
            val code = connection.responseCode
            connection.disconnect()
            throw IOException(
                if (code == 404) {
                    "Auf dem Server liegt dafuer nichts bereit (404)."
                } else {
                    "Server antwortete mit $code."
                },
            )
        }

        return connection
    }

    /**
     * Die Meldungen der Netzschicht sind oft nur ein Hostname oder leer. Was
     * hier herauskommt, steht spaeter woertlich in der App.
     */
    private fun describe(error: Throwable): String = when (error) {
        is java.net.UnknownHostException ->
            "Keine Verbindung - der Server ist nicht erreichbar."
        is java.net.SocketTimeoutException ->
            "Zeitueberschreitung beim Laden."
        is SecurityException ->
            "Das System hat die Installation verweigert. Fehlt die Erlaubnis " +
                "\"Unbekannte Apps installieren\"?"
        else -> error.message ?: error.javaClass.simpleName
    }
}
