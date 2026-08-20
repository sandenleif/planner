import { isDesktop } from './platform'
import { toast } from '@/ui/toast'

/**
 * Automatische Aktualisierungen für die Desktop-App.
 *
 * Ablauf: Die App fragt beim Start das Manifest bei GitHub Releases ab. Gibt
 * es eine neuere Version, erscheint eine Meldung mit einem Knopf. Erst auf
 * Klick wird geladen und eingespielt — ungefragt an einer laufenden App
 * herumzuschrauben ist keine gute Idee, und ein Neustart mitten im Tippen
 * erst recht nicht.
 *
 * Die Pakete sind signiert; der öffentliche Schlüssel steckt in
 * `tauri.conf.json`. Ein Update, dessen Signatur nicht passt, wird abgelehnt.
 * Das ist der Grund, warum der Auslieferungsweg (GitHub) nicht vertrauenswürdig
 * sein muss: wer das Release austauscht, hat trotzdem nicht den privaten
 * Schlüssel.
 *
 * NICHT auf Android: dort ist ein In-App-Updater systemseitig nicht
 * vorgesehen, Aktualisierungen laufen über den Store oder manuell. Und nicht
 * im Web — dort ist ein Neuladen der Seite die Aktualisierung.
 */

/** Wie lange nach dem Start gewartet wird, bevor geprüft wird. */
const INITIAL_DELAY_MS = 4000

/** Abstand zwischen zwei Prüfungen bei lange laufender App. */
const RECHECK_INTERVAL_MS = 1000 * 60 * 60 * 6

let started = false

export function startUpdateChecks(): () => void {
  // Nur Desktop. isDesktop ist bereits false im Browser und auf Android.
  if (!isDesktop || started) return () => {}
  started = true

  let cancelled = false

  const check = async () => {
    if (cancelled) return
    try {
      const { check: checkForUpdate } = await import('@tauri-apps/plugin-updater')
      const update = await checkForUpdate()
      if (!update || cancelled) return

      toast.withAction(
        `Version ${update.version} ist da`,
        'Installieren',
        () => void install(update),
      )
    } catch (error) {
      // Kein Netz, GitHub gerade nicht erreichbar, noch kein Release
      // veröffentlicht - alles kein Grund, den Nutzer zu behelligen.
      console.warn('Update-Prüfung fehlgeschlagen:', error)
    }
  }

  const timer = setTimeout(() => {
    void check()
  }, INITIAL_DELAY_MS)

  const interval = setInterval(() => {
    void check()
  }, RECHECK_INTERVAL_MS)

  return () => {
    cancelled = true
    clearTimeout(timer)
    clearInterval(interval)
  }
}

interface InstallableUpdate {
  version: string
  downloadAndInstall(onEvent?: (event: { event: string }) => void): Promise<void>
}

async function install(update: InstallableUpdate): Promise<void> {
  const progress = toast.show(`Version ${update.version} wird geladen …`, 60_000)

  try {
    await update.downloadAndInstall()

    const { useToastStore } = await import('@/ui/toast')
    useToastStore.getState().dismiss(progress)

    // Neustart nicht erzwingen: Wer gerade mitten in etwas steckt, soll
    // selbst entscheiden. Beim nächsten Start ist die neue Version ohnehin da.
    toast.withAction('Update eingespielt', 'Jetzt neu starten', () => {
      void restart()
    })
  } catch (error) {
    const { useToastStore } = await import('@/ui/toast')
    useToastStore.getState().dismiss(progress)
    toast.error(
      `Update fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function restart(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}
