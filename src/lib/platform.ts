/**
 * Laufzeit-Weichen.
 *
 * Derselbe Bundle laeuft im Browser, in einer WebView2 unter Windows, in einer
 * WKWebView unter macOS und in der Android-WebView. Alles, was nur in einer
 * dieser Umgebungen existiert, wird hier abgefragt - nie verstreut in
 * Komponenten. Dann bleibt der Web-Build funktionsfaehig, auch wenn spaeter
 * Tauri-Plugins dazukommen.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export type OsName = 'windows' | 'macos' | 'linux' | 'android' | 'unknown'

/**
 * Tauri v2 injiziert __TAURI_INTERNALS__ in die WebView. Bewusst als
 * Property-Check statt Import aus @tauri-apps/api: im Browser gibt es das
 * Objekt nicht, und ein Import wuerde beim Web-Build nur totes Gewicht sein.
 */
export const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const osName: OsName = detectOs()

export const isDesktop = isTauri && (osName === 'windows' || osName === 'macos' || osName === 'linux')
export const isAndroid = osName === 'android'
export const isWeb = !isTauri

/** Touch-Bedienung: groessere Trefferflaechen, keine Hover-Affordanzen. */
export const isTouchPrimary =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

/** Auf macOS heisst der Modifier Cmd, sonst Ctrl. */
export const modKeyLabel = osName === 'macos' ? '⌘' : 'Strg'

/** Prueft den plattformrichtigen Modifier eines Tastatur-Events. */
export function hasModKey(
  event: KeyboardEvent | ReactKeyboardEvent<Element>,
): boolean {
  return osName === 'macos' ? event.metaKey : event.ctrlKey
}

function detectOs(): OsName {
  if (typeof navigator === 'undefined') return 'unknown'

  // userAgentData ist praeziser, existiert aber nicht in WebKit.
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData
  const platform = (uaData?.platform ?? navigator.userAgent).toLowerCase()

  if (platform.includes('android')) return 'android'
  if (platform.includes('win')) return 'windows'
  if (platform.includes('mac')) return 'macos'
  if (platform.includes('linux')) return 'linux'
  return 'unknown'
}
