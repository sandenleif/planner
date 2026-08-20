import { isDesktop, isTauri } from './platform'
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
 * Dazu `checkForUpdatesNow()` für den Knopf in den Einstellungen. Beide Wege
 * teilen sich Abfrage und Installation; der Unterschied liegt allein darin,
 * was passiert, wenn es nichts zu holen gibt: die automatische Prüfung
 * schweigt, die angestoßene antwortet.
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
      const update = await fetchUpdate()
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

// ------------------------------------------------------- Suchen auf Zuruf

/**
 * Ergebnis einer angestoßenen Suche.
 *
 * Die automatische Prüfung darf schweigen, wenn nichts da ist — die hier
 * gestartete nicht. Wer auf einen Knopf drückt, erwartet eine Antwort, und
 * „keine Meldung" ist von „hat nicht funktioniert" nicht zu unterscheiden.
 * Deshalb hat jeder Ausgang einen eigenen Fall statt eines nullable-Rückgabe­
 * werts.
 */
export type UpdateCheck =
  | { status: 'available'; version: string; install: () => void }
  | { status: 'current' }
  /** Web und Android: dort aktualisiert der Browser bzw. der Store. */
  | { status: 'unsupported' }
  | { status: 'failed'; message: string }

export async function checkForUpdatesNow(): Promise<UpdateCheck> {
  if (!isDesktop) return { status: 'unsupported' }

  try {
    const update = await fetchUpdate()
    if (!update) return { status: 'current' }

    return {
      status: 'available',
      version: update.version,
      install: () => void install(update),
    }
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Die laufende Version — aus `tauri.conf.json`, nicht aus `package.json`.
 *
 * Nach dem Einspielen eines Updates ist das die einzige Angabe, die stimmt:
 * das JavaScript-Bundle wird mit ausgetauscht, aber gefragt wird der native
 * Teil, und der ist es, den der Updater ersetzt hat.
 */
export async function appVersion(): Promise<string | null> {
  if (!isTauri) return null

  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch (error) {
    console.warn('Version nicht abrufbar:', error)
    return null
  }
}

async function fetchUpdate(): Promise<InstallableUpdate | null> {
  const { check } = await import('@tauri-apps/plugin-updater')
  return (await check()) as InstallableUpdate | null
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
