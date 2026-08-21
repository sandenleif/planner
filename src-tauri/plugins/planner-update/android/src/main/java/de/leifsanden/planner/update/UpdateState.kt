package de.leifsanden.planner.update

import java.util.concurrent.atomic.AtomicLong

/**
 * Wo das Update gerade steht.
 *
 * Warum ein gemeinsamer Zustand und kein Rueckruf ins Frontend: Der Ablauf
 * verlaeuft ueber drei Prozessgrenzen - der Ladevorgang laeuft in einem eigenen
 * Thread, den Systemdialog zeigt der PackageInstaller, und die Antwort darauf
 * trifft in einem BroadcastReceiver ein. Ein Rueckruf muesste durch alle drei
 * hindurchgereicht werden und ausserdem ueberleben, dass die App zwischendurch
 * in den Hintergrund geraet. Ein Ort, an dem der Stand steht und den das
 * Frontend abfragt, kommt ohne das aus.
 *
 * Deshalb fragt src/lib/updater.ts im Sekundentakt nach, statt auf ein Signal
 * zu warten. Bei einem Vorgang, der ohnehin Sekunden bis Minuten dauert, ist
 * das der einfachere und der robustere Weg.
 */
object UpdateState {

    const val IDLE = "idle"

    /** APK wird geladen; `bytes` und `total` fuellen sich. */
    const val DOWNLOADING = "downloading"

    /** Vollstaendig geladen, an den PackageInstaller uebergeben. */
    const val INSTALLING = "installing"

    /** Der Systemdialog steht offen und wartet auf den Nutzer. */
    const val CONFIRM = "confirm"

    /**
     * Wird in der Praxis selten gelesen: Bei Erfolg ersetzt Android das Paket
     * und beendet dabei den eigenen Prozess. Wer diesen Wert sieht, hat ein
     * Update auf eine bereits laufende gleiche Fassung erwischt.
     */
    const val SUCCESS = "success"

    /** Der Nutzer hat den Systemdialog abgebrochen. */
    const val CANCELLED = "cancelled"

    const val FAILED = "failed"

    @Volatile
    var state: String = IDLE

    @Volatile
    var message: String? = null

    val bytes = AtomicLong(0)
    val total = AtomicLong(0)

    /** Setzt zurueck - ein zweiter Versuch soll nicht den alten Stand zeigen. */
    @Synchronized
    fun begin() {
        state = DOWNLOADING
        message = null
        bytes.set(0)
        total.set(0)
    }

    @Synchronized
    fun fail(reason: String) {
        state = FAILED
        message = reason
    }

    /** Ob gerade etwas laeuft. Verhindert zwei Ladevorgaenge nebeneinander. */
    fun busy(): Boolean = state == DOWNLOADING || state == INSTALLING || state == CONFIRM
}
