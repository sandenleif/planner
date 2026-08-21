package de.leifsanden.planner.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/**
 * Nimmt entgegen, was der PackageInstaller ueber den Vorgang meldet.
 *
 * Der wichtigste Fall ist STATUS_PENDING_USER_ACTION: Eine App ohne
 * Systemrechte darf sich nicht selbst installieren, das System will den Nutzer
 * fragen. Es legt den fertigen Dialog als Intent bei, und dieser Empfaenger
 * startet ihn. Erst danach entscheidet sich, ob installiert wird.
 *
 * Genau dieser Dialog ist es uebrigens, der beim Update "Deine vorhandenen
 * Daten gehen nicht verloren" anzeigt - er unterscheidet ein Update von einer
 * Neuinstallation, und er tut das nur, weil Paketname und Signatur passen.
 */
class InstallResultReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> confirm(context, intent)

            PackageInstaller.STATUS_SUCCESS -> UpdateState.state = UpdateState.SUCCESS

            // Der Nutzer hat im Systemdialog abgelehnt. Kein Fehler, sondern
            // eine Entscheidung - und deshalb ohne rote Meldung.
            PackageInstaller.STATUS_FAILURE_ABORTED -> UpdateState.state = UpdateState.CANCELLED

            PackageInstaller.STATUS_FAILURE_CONFLICT -> UpdateState.fail(
                "Das System hat das Paket abgelehnt. Das passiert, wenn die " +
                    "installierte Fassung mit einem anderen Schluessel signiert " +
                    "ist als die neue.",
            )

            PackageInstaller.STATUS_FAILURE_STORAGE -> UpdateState.fail(
                "Zu wenig freier Speicher auf dem Geraet.",
            )

            else -> UpdateState.fail(
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    ?: "Installation fehlgeschlagen (Status $status).",
            )
        }
    }

    private fun confirm(context: Context, intent: Intent) {
        val dialog = extractIntent(intent)

        if (dialog == null) {
            UpdateState.fail("Das System hat den Bestaetigungsdialog nicht mitgeliefert.")
            return
        }

        UpdateState.state = UpdateState.CONFIRM

        // Aus einem BroadcastReceiver heraus gibt es keine Activity, an die
        // sich der Dialog haengen koennte - ohne NEW_TASK lehnt Android den
        // Start ab. Erlaubt ist er, weil die App in diesem Moment im
        // Vordergrund steht: Der Nutzer hat das Update gerade angestossen.
        dialog.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        try {
            context.startActivity(dialog)
        } catch (error: Exception) {
            UpdateState.fail(error.message ?: "Bestaetigungsdialog liess sich nicht oeffnen.")
        }
    }

    /**
     * getParcelableExtra(String) ist ab Android 13 als unsicher verworfen, die
     * typisierte Fassung gibt es erst ab da. Beide Wege sind noetig, solange
     * minSdk 24 ist.
     */
    @Suppress("DEPRECATION")
    private fun extractIntent(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }

    companion object {
        /**
         * Der Rueckkanal, den `session.commit()` erwartet.
         *
         * MUTABLE ist ab Android 12 Pflicht und kein Versehen: Das System legt
         * beim Zustellen selbst die Extras hinein - Status, Meldung, Dialog.
         * Ein unveraenderlicher PendingIntent kaeme hier leer an.
         */
        fun sender(context: Context): android.content.IntentSender {
            val intent = Intent(context, InstallResultReceiver::class.java)

            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }

            return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags).intentSender
        }

        private const val REQUEST_CODE = 4711
    }
}
