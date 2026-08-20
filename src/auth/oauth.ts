import { isTauri } from '@/lib/platform'

/**
 * Der Rückweg aus der Google-Anmeldung.
 *
 * Im Browser ist das unspektakulär: Supabase leitet auf die App zurück, der
 * Supabase-Client sieht `?code=…` in der URL und tauscht ihn selbst gegen eine
 * Sitzung (`detectSessionInUrl`).
 *
 * In der Desktop- und Android-App geht das nicht, weil es keine http-Adresse
 * gibt, auf die Google zurückleiten könnte. Der Weg dort:
 *
 *   1. Die App holt sich von Supabase die Anmelde-URL, folgt ihr aber NICHT
 *      selbst (`skipBrowserRedirect`).
 *   2. Sie öffnet die URL im **Systembrowser**. Das ist kein Umweg, sondern
 *      der Punkt: Google verweigert die Anmeldung in eingebetteten WebViews,
 *      und der Nutzer soll die echte Adresszeile sehen, bevor er sein Passwort
 *      eintippt.
 *   3. Nach der Anmeldung schickt Supabase den Browser auf
 *      `planner://auth-callback?code=…`. Das Betriebssystem reicht diese URL
 *      an die laufende App weiter (siehe src-tauri/src/lib.rs).
 *   4. Die App löst den Code gegen eine Sitzung ein.
 *
 * Der PKCE-Verifier bleibt dabei die ganze Zeit im localStorage derselben
 * WebView - er verlässt das Gerät nie. Deshalb funktioniert der Tausch in
 * Schritt 4 auch dann, wenn die Anmeldung selbst in einem anderen Programm
 * stattgefunden hat.
 */

/** Muss zu OAUTH_EVENT in src-tauri/src/lib.rs passen. */
export const OAUTH_CALLBACK_EVENT = 'oauth://callback'

/** Muss in Supabase unter Authentication → URL Configuration erlaubt sein. */
export const TAURI_REDIRECT_URL = 'planner://auth-callback'

export function oauthRedirectUrl(): string {
  return isTauri ? TAURI_REDIRECT_URL : window.location.origin
}

export interface OAuthCallback {
  code: string | null
  error: string | null
}

/**
 * Liest Code bzw. Fehler aus einer Rücksprung-URL.
 *
 * Sieht sich Query UND Fragment an: PKCE liefert `?code=`, der ältere
 * Implicit-Flow `#access_token=`. Die App nutzt PKCE, aber eine
 * Provider-Einstellung im Dashboard kann das ändern - dann soll wenigstens
 * eine verständliche Meldung erscheinen statt gar nichts.
 */
export function readOAuthCallback(rawUrl: string): OAuthCallback {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { code: null, error: null }
  }

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))

  const errorDescription =
    url.searchParams.get('error_description') ?? fragment.get('error_description')
  const errorCode = url.searchParams.get('error') ?? fragment.get('error')

  if (errorDescription || errorCode) {
    return { code: null, error: errorDescription ?? errorCode }
  }

  const code = url.searchParams.get('code')
  if (code) return { code, error: null }

  if (fragment.get('access_token')) {
    return {
      code: null,
      error:
        'Die Anmeldung kam im alten Implicit-Format zurück. In Supabase unter ' +
        'Authentication → Providers muss PKCE aktiv sein.',
    }
  }

  return { code: null, error: null }
}

/** Öffnet eine URL außerhalb der App - im Browser schlicht als Navigation. */
export async function openExternally(url: string): Promise<void> {
  if (!isTauri) {
    window.location.href = url
    return
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

/**
 * Horcht auf Rücksprünge. Rückgabe ist die Abmeldefunktion.
 *
 * Zwei Quellen, weil ein Fall sonst durchrutscht: `listen` deckt die laufende
 * App ab, `getCurrent()` den Fall, dass der Deep-Link die App überhaupt erst
 * gestartet hat - dann ist das Ereignis schon durch, bevor React steht.
 */
export async function listenForOAuthCallback(
  onUrl: (url: string) => void,
): Promise<() => void> {
  if (!isTauri) return () => {}

  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<string>(OAUTH_CALLBACK_EVENT, (event) => {
    onUrl(event.payload)
  })

  try {
    const { getCurrent } = await import('@tauri-apps/plugin-deep-link')
    const startupUrls = await getCurrent()
    for (const url of startupUrls ?? []) onUrl(url)
  } catch {
    // getCurrent() gibt es nicht auf jeder Plattform - kein Grund zu scheitern.
  }

  return unlisten
}

/**
 * Entfernt `?code=…` aus der Adresszeile, nachdem der Browser-Rücksprung
 * verarbeitet wurde.
 *
 * Kosmetik ist das nicht: bleibt der Code stehen, landet er im Verlauf, in
 * Lesezeichen und in jedem Screenshot. Er ist zwar nur einmal einlösbar und
 * ohne den PKCE-Verifier nutzlos - aber es gibt keinen Grund, ihn aufzuheben.
 */
export function clearOAuthParamsFromUrl(): void {
  if (isTauri || typeof window === 'undefined') return

  const url = new URL(window.location.href)
  const dirty = ['code', 'error', 'error_description', 'state'].filter((key) =>
    url.searchParams.has(key),
  )
  if (dirty.length === 0) return

  for (const key of dirty) url.searchParams.delete(key)
  window.history.replaceState({}, '', url.toString())
}
