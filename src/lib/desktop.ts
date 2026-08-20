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
