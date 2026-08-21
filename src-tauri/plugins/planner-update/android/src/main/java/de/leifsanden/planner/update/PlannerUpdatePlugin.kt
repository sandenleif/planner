package de.leifsanden.planner.update

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.concurrent.thread

/**
 * Die Befehle, die src/lib/updater.ts auf Android aufruft.
 *
 * Die Klasse selbst haelt nichts fest: Der Stand liegt in [UpdateState], die
 * Arbeit in [ApkInstaller]. Das ist noetig, weil der Ablauf laenger dauert als
 * ein Befehl - zwischen "laden" und "installiert" liegt ein Systemdialog, und
 * waehrenddessen kann die Activity neu aufgebaut werden.
 */

@InvokeArg
class StartArgs {
    var url: String = ""
}

@TauriPlugin
class PlannerUpdatePlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * Auf eigenem Thread: Ein Netzzugriff auf dem Haupt-Thread beendet die App
     * unter Android sofort mit einer NetworkOnMainThreadException. Ob Tauri
     * Befehle im Vorder- oder Hintergrund ausfuehrt, ist nicht zugesichert -
     * also nicht darauf bauen.
     */
    @Command
    fun fetchManifest(invoke: Invoke) {
        thread(name = "planner-manifest", isDaemon = true) {
            try {
                val result = JSObject()
                result.put("json", ApkInstaller.manifest())
                invoke.resolve(result)
            } catch (error: Throwable) {
                invoke.reject(error.message ?: "latest.json ist nicht erreichbar.")
            }
        }
    }

    /**
     * Ob der Nutzer dieser App das Installieren erlaubt hat.
     *
     * Wird VOR dem Laden gefragt. Andersherum liefe ein Download ueber
     * mehrere Dutzend Megabyte, nur um am Ende an einer Erlaubnis zu
     * scheitern, die man vorher haette einholen koennen.
     */
    @Command
    fun canInstall(invoke: Invoke) {
        val result = JSObject()
        result.put("allowed", installAllowed())
        invoke.resolve(result)
    }

    /**
     * Fuehrt zur Systemeinstellung "Unbekannte Apps installieren", und zwar
     * direkt zum Eintrag dieser App - nicht in die Liste aller Apps.
     */
    @Command
    fun openInstallSettings(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            invoke.reject("Diese Einstellung gibt es erst ab Android 8.")
            return
        }

        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${activity.packageName}"),
        )

        try {
            activity.startActivity(intent)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Die Einstellung liess sich nicht oeffnen.")
        }
    }

    /**
     * Kehrt sofort zurueck. Was danach passiert, steht in [updateState] -
     * siehe die Begruendung fuer den gemeinsamen Zustand dort.
     */
    @Command
    fun startUpdate(invoke: Invoke) {
        val args = invoke.parseArgs(StartArgs::class.java)
        ApkInstaller.start(activity, args.url)
        invoke.resolve()
    }

    @Command
    fun updateState(invoke: Invoke) {
        val result = JSObject()
        result.put("state", UpdateState.state)
        result.put("bytes", UpdateState.bytes.get())
        result.put("total", UpdateState.total.get())

        // Nur bei einem Fehler gesetzt. Ein fehlender Schluessel wird auf der
        // Rust-Seite zu None - deshalb hier kein leerer Text.
        UpdateState.message?.let { result.put("message", it) }

        invoke.resolve(result)
    }

    private fun installAllowed(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.packageManager.canRequestPackageInstalls()
        } else {
            // Vor Android 8 galt ein geraeteweiter Schalter, den eine App nicht
            // abfragen kann. Dann lieber losgehen und den Fehler des Systems
            // zeigen, als etwas zu behaupten.
            true
        }
}
