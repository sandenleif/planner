import { isAndroidApp, isDesktop, isTauri } from './platform'
import { toast } from '@/ui/toast'

/**
 * Automatische Aktualisierungen für Desktop und Android.
 *
 * Ablauf auf beiden: Die App fragt beim Start das Manifest bei GitHub Releases
 * ab. Gibt es eine neuere Version, erscheint eine Meldung mit einem Knopf. Erst
 * auf Klick wird geladen und eingespielt — ungefragt an einer laufenden App
 * herumzuschrauben ist keine gute Idee, und ein Neustart mitten im Tippen erst
 * recht nicht.
 *
 * Dazu `checkForUpdatesNow()` für den Knopf in den Einstellungen. Beide Wege
 * teilen sich Suche und Installation; der Unterschied liegt allein darin, was
 * passiert, wenn es nichts zu holen gibt: die automatische Prüfung schweigt,
 * die angestoßene antwortet.
 *
 * Unterhalb davon sind es zwei verschiedene Vorgänge:
 *
 * - **Desktop** über tauri-plugin-updater. Der lädt das Paket, prüft die
 *   minisign-Signatur und tauscht die Dateien aus. Der öffentliche Schlüssel
 *   steckt in `tauri.conf.json`; ein Paket mit falscher Signatur wird
 *   abgelehnt. Deshalb muss der Auslieferungsweg nicht vertrauenswürdig sein.
 *
 * - **Android** über den PackageInstaller des Systems, siehe
 *   `src-tauri/plugins/planner-update`. Dort ersetzt nicht die App die Dateien,
 *   sondern das System das ganze Paket — und prüft dabei selbst, ob die
 *   Signatur zur installierten Fassung passt. Weil dieselbe Signatur auch die
 *   Bedingung dafür ist, dass die App-Daten erhalten bleiben, ist das
 *   gleichzeitig die Zusage: Der Nutzer bleibt angemeldet.
 *
 * Nicht im Web — dort ist ein Neuladen der Seite die Aktualisierung.
 */

/** Wie lange nach dem Start gewartet wird, bevor geprüft wird. */
const INITIAL_DELAY_MS = 4000

/** Abstand zwischen zwei Prüfungen bei lange laufender App. */
const RECHECK_INTERVAL_MS = 1000 * 60 * 60 * 6

let started = false

export function startUpdateChecks(): () => void {
  // Im Browser gibt es nichts einzuspielen. isDesktop und isAndroidApp
  // schließen beide isTauri ein.
  if ((!isDesktop && !isAndroidApp) || started) return () => {}
  started = true

  let cancelled = false

  const check = async () => {
    if (cancelled) return
    try {
      const update = await findUpdate()
      if (!update || cancelled) return

      toast.withAction(`Version ${update.version} ist da`, 'Installieren', update.install)
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
  /** Nur noch das Web: dort aktualisiert der Browser. */
  | { status: 'unsupported' }
  | { status: 'failed'; message: string }

export async function checkForUpdatesNow(): Promise<UpdateCheck> {
  if (!isDesktop && !isAndroidApp) return { status: 'unsupported' }

  try {
    const update = await findUpdate()
    if (!update) return { status: 'current' }

    return { status: 'available', version: update.version, install: update.install }
  } catch (error) {
    return { status: 'failed', message: describe(error) }
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

/** Was beide Plattformen zurückgeben — die Unterschiede stecken in `install`. */
interface PendingUpdate {
  version: string
  install: () => void
}

function findUpdate(): Promise<PendingUpdate | null> {
  return isAndroidApp ? findAndroidUpdate() : findDesktopUpdate()
}

// ---------------------------------------------------------------- Desktop

interface InstallableUpdate {
  version: string
  downloadAndInstall(onEvent?: (event: { event: string }) => void): Promise<void>
}

async function findDesktopUpdate(): Promise<PendingUpdate | null> {
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = (await check()) as InstallableUpdate | null
  if (!update) return null

  return { version: update.version, install: () => void installDesktop(update) }
}

async function installDesktop(update: InstallableUpdate): Promise<void> {
  const progress = toast.show(`Version ${update.version} wird geladen …`, 60_000)

  try {
    await update.downloadAndInstall()
    toast.dismiss(progress)

    // Neustart nicht erzwingen: Wer gerade mitten in etwas steckt, soll
    // selbst entscheiden. Beim nächsten Start ist die neue Version ohnehin da.
    toast.withAction('Update eingespielt', 'Jetzt neu starten', () => {
      void restart()
    })
  } catch (error) {
    toast.dismiss(progress)
    toast.error(`Update fehlgeschlagen: ${describe(error)}`)
  }
}

async function restart(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

// ---------------------------------------------------------------- Android

/**
 * Der Eintrag, den die CI zusätzlich in latest.json schreibt (siehe
 * scripts/android-latest-json.mjs). Die Desktop-Einträge daneben heißen
 * `windows-x86_64`, `darwin-aarch64` und so fort; tauri-plugin-updater
 * übergeht unbekannte Schlüssel, deshalb stört dieser dort nicht.
 */
const ANDROID_PLATFORM = 'android-universal'

/** Abstand der Nachfragen, während geladen wird. */
const POLL_MS = 700

/**
 * Nach dieser Zeit hört das Frontend auf nachzufragen. Nicht der Abbruch des
 * Vorgangs — der läuft im Kotlin-Teil weiter, und der Systemdialog steht
 * ohnehin vor der App. Es ist nur die Grenze, ab der eine Schleife im
 * Hintergrund keinen Zweck mehr hat.
 */
const POLL_DEADLINE_MS = 10 * 60 * 1000

interface AndroidManifest {
  version?: string
  platforms?: Record<string, { url?: string } | undefined>
}

interface AndroidState {
  state: 'idle' | 'downloading' | 'installing' | 'confirm' | 'success' | 'cancelled' | 'failed'
  bytes: number
  total: number
  message: string | null
}

async function callPlugin<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(`plugin:planner-update|${command}`, args)
}

async function findAndroidUpdate(): Promise<PendingUpdate | null> {
  const { json } = await callPlugin<{ json: string }>('fetch_manifest')
  const manifest = JSON.parse(json) as AndroidManifest

  const url = manifest.platforms?.[ANDROID_PLATFORM]?.url
  // Ein Release ohne APK-Eintrag ist kein Fehler: Bis Version 1.0.5 gab es
  // ihn nicht, und ein Lauf ohne Android-Signatur lässt ihn bis heute weg.
  if (!url) return null

  const latest = manifest.version?.replace(/^v/, '')
  const current = await appVersion()
  if (!latest || !current) return null
  if (compareVersions(latest, current) <= 0) return null

  return { version: latest, install: () => void installAndroid(latest, url) }
}

/**
 * Lädt und installiert.
 *
 * Die Erlaubnis wird VOR dem Laden geprüft. Andersherum lädt die App vierzig
 * Megabyte, um dann an einem Schalter zu scheitern, den man vorher hätte
 * umlegen können — auf mobilen Daten ist das kein Schönheitsfehler.
 */
async function installAndroid(version: string, url: string): Promise<void> {
  let allowed: boolean
  try {
    ;({ allowed } = await callPlugin<{ allowed: boolean }>('can_install'))
  } catch (error) {
    toast.error(`Update fehlgeschlagen: ${describe(error)}`)
    return
  }

  if (!allowed) {
    toast.withAction(
      'Android muss dafür erst „Unbekannte Apps installieren" erlauben.',
      'Einstellung öffnen',
      () => void callPlugin('open_install_settings'),
    )
    return
  }

  const progress = toast.show(`Version ${version} wird geladen …`, POLL_DEADLINE_MS)

  try {
    await callPlugin('start_update', { url })
  } catch (error) {
    toast.dismiss(progress)
    toast.error(`Update fehlgeschlagen: ${describe(error)}`)
    return
  }

  const deadline = Date.now() + POLL_DEADLINE_MS

  while (Date.now() < deadline) {
    await sleep(POLL_MS)

    let state: AndroidState
    try {
      state = await callPlugin<AndroidState>('update_state')
    } catch (error) {
      toast.dismiss(progress)
      toast.error(`Update fehlgeschlagen: ${describe(error)}`)
      return
    }

    switch (state.state) {
      case 'downloading':
        toast.update(progress, downloadLabel(version, state))
        break

      case 'installing':
        toast.update(progress, 'Wird eingespielt …')
        break

      case 'confirm':
        // Ab hier liegt der Systemdialog über der App. Er nennt es „Update"
        // und sagt zu, dass die Daten erhalten bleiben — beides, weil Paket
        // und Signatur zur installierten Fassung passen.
        toast.update(progress, 'Bitte im Systemdialog bestätigen.')
        break

      // Wird selten zu sehen sein: Bei Erfolg ersetzt Android das Paket und
      // beendet dabei diesen Prozess. Danach ist die App neu — und der Nutzer
      // immer noch angemeldet.
      case 'success':
        toast.dismiss(progress)
        return

      case 'cancelled':
        toast.dismiss(progress)
        toast.show('Update abgebrochen.')
        return

      case 'failed':
        toast.dismiss(progress)
        toast.error(`Update fehlgeschlagen: ${state.message ?? 'unbekannter Fehler'}`)
        return

      default:
        break
    }
  }

  toast.dismiss(progress)
}

function downloadLabel(version: string, state: AndroidState): string {
  if (state.total > 0) {
    // Bei 100 Prozent ist noch nicht installiert, sondern erst geladen. Die
    // Anzeige bleibt deshalb bei 99, bis der nächste Zustand das Wort hat.
    const percent = Math.min(99, Math.round((state.bytes / state.total) * 100))
    return `Version ${version} wird geladen … ${percent} %`
  }

  const mb = (state.bytes / 1_000_000).toFixed(1)
  return `Version ${version} wird geladen … ${mb} MB`
}

/**
 * Vergleicht „1.2.10" mit „1.2.9" richtig — im Gegensatz zu einem
 * Zeichenkettenvergleich, der die 10 vor die 9 sortierte.
 *
 * Bewusst ohne semver-Bibliothek: Die Versionen kommen aus `tauri.conf.json`
 * und sind schlichte Dreiergruppen. Sobald eine Vorabversion wie „1.1.0-beta"
 * dazukommt, reicht das hier nicht mehr — sie würde wie 1.1.0 behandelt.
 */
function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split('.').map((part) => parseInt(part, 10) || 0)
  const left = parts(a)
  const right = parts(b)

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) return difference
  }

  return 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
