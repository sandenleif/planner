import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, supabaseConfigured } from '@/lib/supabase'
import { isTauri } from '@/lib/platform'
import {
  clearOAuthParamsFromUrl,
  listenForOAuthCallback,
  oauthRedirectUrl,
  openExternally,
  readOAuthCallback,
} from './oauth'

/**
 * Authentifizierung - oder deren bewusste Abwesenheit.
 *
 * Ohne Supabase-Konfiguration laeuft die App im Local-Modus: kein Login,
 * kein Nutzerkonto, Daten liegen in IndexedDB. Das ist kein Notbehelf,
 * sondern der Startzustand, in dem man die App sofort benutzen kann.
 */

export type AuthMode = 'local' | 'supabase'

export interface AuthState {
  mode: AuthMode
  /** Solange true, ist noch unklar, ob eine Sitzung existiert. */
  loading: boolean
  session: Session | null
  userId: string | null
  email: string | null
  displayName: string | null
  avatarUrl: string | null
  /**
   * Fehler aus einem OAuth-Rueckweg. Der passiert ausserhalb jeder
   * Komponente - deshalb liegt er hier und nicht im Anmeldebildschirm.
   */
  oauthError: string | null
  clearOAuthError(): void
  /** Laeuft gerade eine Google-Anmeldung? Steuert nur die Anzeige. */
  oauthPending: boolean
  signInWithPassword(email: string, password: string): Promise<void>
  signUpWithPassword(email: string, password: string): Promise<{ needsConfirm: boolean }>
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(supabaseConfigured)
  const [oauthError, setOAuthError] = useState<string | null>(null)
  const [oauthPending, setOAuthPending] = useState(false)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return

    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
      if (next) setOAuthPending(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /** Loest einen Rueckkehr-Code gegen eine Sitzung ein. */
  const exchangeCode = useCallback(async (rawUrl: string) => {
    const { code, error } = readOAuthCallback(rawUrl)

    if (error) {
      setOAuthError(translateAuthError(error))
      setOAuthPending(false)
      return
    }
    if (!code) return

    const supabase = getSupabase()
    if (!supabase) return

    const result = await supabase.auth.exchangeCodeForSession(code)
    if (result.error) {
      setOAuthError(translateAuthError(result.error.message))
    }
    setOAuthPending(false)
  }, [])

  // Desktop und Android: auf planner://auth-callback horchen.
  //
  // Nur im Hauptfenster. Die Rust-Seite sendet das Ereignis zwar gezielt
  // dorthin, aber getCurrent() liefert beim Start in JEDEM Fenster die URL,
  // mit der die App geoeffnet wurde. Ohne diese Sperre wuerde das Panel
  // denselben Code ein zweites Mal einloesen - und scheitern.
  useEffect(() => {
    if (!isTauri || !supabaseConfigured) return
    if (window.location.hash.startsWith('#/panel')) return

    let unlisten: (() => void) | null = null
    let cancelled = false

    void listenForOAuthCallback((url) => void exchangeCode(url)).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [exchangeCode])

  // Browser: den Code hat der Supabase-Client schon selbst eingeloest
  // (detectSessionInUrl). Hier bleibt nur, Fehler sichtbar zu machen und die
  // Adresszeile aufzuraeumen.
  useEffect(() => {
    if (isTauri || typeof window === 'undefined') return

    const { error } = readOAuthCallback(window.location.href)
    if (error) setOAuthError(translateAuthError(error))

    // Nach dem Auslesen - sonst waere der Fehler beim naechsten Render weg,
    // bevor er angezeigt wurde.
    clearOAuthParamsFromUrl()
  }, [])

  const value = useMemo<AuthState>(() => {
    const meta = session?.user.user_metadata as
      | { full_name?: string; name?: string; avatar_url?: string; picture?: string }
      | undefined

    return {
      mode: supabaseConfigured ? 'supabase' : 'local',
      loading,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      displayName: meta?.full_name ?? meta?.name ?? session?.user.email ?? null,
      avatarUrl: meta?.avatar_url ?? meta?.picture ?? null,
      oauthError,
      oauthPending,

      clearOAuthError() {
        setOAuthError(null)
      },

      async signInWithPassword(email, password) {
        const supabase = getSupabase()
        if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(translateAuthError(error.message))
      },

      async signUpWithPassword(email, password) {
        const supabase = getSupabase()
        if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw new Error(translateAuthError(error.message))
        // Ist "Confirm email" im Supabase-Projekt aktiv, kommt hier ein User
        // ohne Session zurueck - dann wartet eine Bestaetigungsmail.
        return { needsConfirm: data.session === null }
      },

      async signInWithGoogle() {
        const supabase = getSupabase()
        if (!supabase) throw new Error('Supabase ist nicht konfiguriert')

        setOAuthError(null)
        setOAuthPending(true)

        try {
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: oauthRedirectUrl(),
              // In Tauri folgt die App der URL nicht selbst, sondern gibt sie
              // an den Systembrowser. Google lehnt eingebettete WebViews ab.
              skipBrowserRedirect: isTauri,
              // offline + consent liefern einen Google-Refresh-Token - die
              // Grundlage fuer den spaeteren Tasks-/Calendar-Sync.
              queryParams: { access_type: 'offline', prompt: 'consent' },
              scopes: 'email profile',
            },
          })

          if (error) throw new Error(translateAuthError(error.message))

          if (isTauri) {
            if (!data?.url) throw new Error('Supabase hat keine Anmelde-URL geliefert')
            await openExternally(data.url)
          }
          // Im Browser navigiert supabase-js selbst weg - alles danach
          // passiert nach dem Rücksprung.
        } catch (err) {
          setOAuthPending(false)
          throw err
        }
      },

      async signOut() {
        const supabase = getSupabase()
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }
  }, [session, loading, oauthError, oauthPending])

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> stehen')
  return ctx
}

function translateAuthError(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'E-Mail oder Passwort stimmt nicht.',
    'Email not confirmed': 'Bitte zuerst den Bestätigungslink in der E-Mail anklicken.',
    'User already registered': 'Für diese E-Mail gibt es schon ein Konto.',
    'Password should be at least 6 characters.':
      'Das Passwort braucht mindestens 6 Zeichen.',
    access_denied: 'Die Anmeldung wurde abgebrochen.',
    // Der haeufigste Einrichtungsfehler - deshalb mit Wegbeschreibung.
    'Unsupported provider: provider is not enabled':
      'Google ist im Supabase-Projekt noch nicht aktiviert ' +
      '(Dashboard → Authentication → Providers → Google).',
  }

  if (map[message]) return map[message]

  if (/redirect_uri_mismatch/i.test(message)) {
    return (
      'Google akzeptiert die Rücksprung-Adresse nicht. In der Google Cloud ' +
      'Console muss https://<projekt>.supabase.co/auth/v1/callback als ' +
      'autorisierter Redirect-URI eingetragen sein.'
    )
  }
  if (/requested path is invalid|redirect.*not allowed/i.test(message)) {
    return (
      'Diese Rücksprung-Adresse ist in Supabase nicht freigegeben ' +
      '(Authentication → URL Configuration → Redirect URLs).'
    )
  }

  return message
}
