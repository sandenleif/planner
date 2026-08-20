import { isTauri } from './platform'

/**
 * Brücke vom Menüleisten-Panel zum Hauptfenster.
 *
 * Der Weg führt über einen Rust-Befehl statt über die Fenster-API im
 * Frontend: das Panel darf das Hauptfenster zeigen und fokussieren, aber
 * nicht beliebige Fenster erzeugen oder schließen. Die Berechtigung dafür
 * steht in src-tauri/capabilities/ und bleibt so eng.
 */
export async function openMainWindow(route?: string): Promise<void> {
  if (!isTauri) {
    // Im Browser gibt es kein zweites Fenster - dort ist das Panel ohnehin
    // nur über /#/panel erreichbar, also einfach navigieren.
    if (route) window.location.hash = `#${route}`
    return
  }

  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('open_main_window', { route: route ?? null })
}

/** Schließt das Panel - nach einer Aktion, die ins Hauptfenster führt. */
export async function hidePanel(): Promise<void> {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('hide_panel')
}

// ------------------------------------------------------- Angeheftetes Panel

/**
 * Angeheftet bleibt das Panel stehen, statt beim Klick daneben zu
 * verschwinden — aus dem Popover wird ein Widget auf dem Schreibtisch.
 *
 * Der laufende Zustand liegt in Rust (dort entscheidet sich das Verstecken bei
 * Fokusverlust), die Einstellung des Nutzers hier: Rust hat keinen Ort, an dem
 * eine Kleinigkeit wie diese einen Neustart überlebt, das Frontend schon.
 * Beim Start meldet das Panel den gespeicherten Wert einmal nach unten.
 */
const PINNED_KEY = 'planner:panel-pinned'
const POSITION_KEY = 'planner:panel-position'

/** Muss zu `PANEL_SHOWN` in src-tauri/src/lib.rs passen. */
export const PANEL_SHOWN_EVENT = 'panel://shown'

interface StoredPosition {
  x: number
  y: number
}

export function isPanelPinned(): boolean {
  return localStorage.getItem(PINNED_KEY) === 'true'
}

/**
 * Heftet an oder löst — und stellt beim Anheften erst die gemerkte Position
 * her, bevor Rust das Fenster zeigt. Andersherum sähe man das Panel kurz an
 * der alten Stelle aufblitzen.
 */
export async function setPanelPinned(pinned: boolean): Promise<void> {
  localStorage.setItem(PINNED_KEY, String(pinned))
  if (!isTauri) return

  if (pinned) {
    // Beim allerersten Anheften gibt es noch nichts zu merken - das Panel steht
    // dann gerade unter dem Tray-Symbol. Genau diese Stelle ist die richtige
    // Vorgabe: sie ist die, an der der Nutzer es eben angeheftet hat.
    if (localStorage.getItem(POSITION_KEY)) {
      await restorePanelPosition()
    } else {
      await rememberCurrentPosition()
    }
  }

  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_panel_pinned', { pinned })
}

async function rememberCurrentPosition(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const { x, y } = await getCurrentWindow().outerPosition()
    localStorage.setItem(POSITION_KEY, JSON.stringify({ x, y } satisfies StoredPosition))
  } catch (error) {
    console.warn('Panel-Position nicht gemerkt:', error)
  }
}

/**
 * Merkt sich, wohin der Nutzer das angeheftete Panel schiebt.
 *
 * Nur im angehefteten Zustand: unangeheftet rückt der Positioner das Fenster
 * bei jedem Aufklappen ans Tray-Symbol, und dieses Rücken ist auch nur ein
 * Verschieben. Ohne die Abfrage überschriebe es genau die Stelle, die sich
 * das Panel merken soll.
 *
 * Rückgabe ist die Abmeldefunktion.
 */
export async function watchPanelPosition(): Promise<() => void> {
  if (!isTauri) return () => {}

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const window_ = getCurrentWindow()

  // Beim Ziehen feuert das Ereignis fortlaufend. Gespeichert wird, wo das
  // Fenster liegen geblieben ist - nicht jede Zwischenstation.
  let timer: ReturnType<typeof setTimeout> | undefined

  const unlisten = await window_.onMoved(({ payload }) => {
    if (!isPanelPinned()) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      const position: StoredPosition = { x: payload.x, y: payload.y }
      localStorage.setItem(POSITION_KEY, JSON.stringify(position))
    }, 250)
  })

  return () => {
    clearTimeout(timer)
    unlisten()
  }
}

/**
 * Stellt die gemerkte Position wieder her, sofern sie noch auf einem
 * angeschlossenen Bildschirm liegt.
 *
 * Die Prüfung ist nicht theoretisch: Wer das Panel am Arbeitsplatz auf den
 * zweiten Monitor schiebt und den Rechner danach ohne diesen startet, bekäme
 * ein Fenster bei x = 2400 — sichtbar nirgends, und weil es kein
 * Taskleistensymbol hat, auch nicht zurückzuholen.
 */
async function restorePanelPosition(): Promise<void> {
  const raw = localStorage.getItem(POSITION_KEY)
  if (!raw) return

  let stored: StoredPosition
  try {
    stored = JSON.parse(raw) as StoredPosition
  } catch {
    return
  }

  if (!Number.isFinite(stored?.x) || !Number.isFinite(stored?.y)) return

  try {
    const { availableMonitors } = await import('@tauri-apps/api/window')
    const monitors = await availableMonitors()

    const onScreen = monitors.some(
      (monitor) =>
        stored.x >= monitor.position.x &&
        stored.x < monitor.position.x + monitor.size.width &&
        stored.y >= monitor.position.y &&
        stored.y < monitor.position.y + monitor.size.height,
    )

    if (!onScreen) {
      localStorage.removeItem(POSITION_KEY)
      return
    }

    const { PhysicalPosition } = await import('@tauri-apps/api/dpi')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setPosition(new PhysicalPosition(stored.x, stored.y))
  } catch (error) {
    // Lieber an der Vorgabestelle stehen als gar nicht.
    console.warn('Panel-Position nicht wiederhergestellt:', error)
  }
}

/**
 * Meldet, dass das Panel gerade sichtbar geworden ist.
 *
 * Das Fenster wird nie zerstört, nur versteckt — React montiert also nicht neu,
 * und ohne dieses Signal zeigte das Panel beim Aufklappen den Stand von vorhin.
 * Rückgabe ist die Abmeldefunktion.
 */
export async function onPanelShown(handler: () => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen(PANEL_SHOWN_EVENT, () => handler())
}
