import { createContext, use, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, supabaseConfigured } from '@/lib/supabase'

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
  signInWithPassword(email: string, password: string): Promise<void>
  signUpWithPassword(email: string, password: string): Promise<{ needsConfirm: boolean }>
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(supabaseConfigured)

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
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(() => {
    const meta = session?.user.user_metadata as
      | { full_name?: string; name?: string }
      | undefined

    return {
      mode: supabaseConfigured ? 'supabase' : 'local',
      loading,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      displayName: meta?.full_name ?? meta?.name ?? session?.user.email ?? null,

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
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
            // offline + consent sind noetig, um einen Refresh-Token fuer die
            // Google-APIs zu bekommen - Grundlage fuer den spaeteren
            // Tasks-/Calendar-Sync.
            queryParams: { access_type: 'offline', prompt: 'consent' },
            scopes: 'email profile',
          },
        })
        if (error) throw new Error(translateAuthError(error.message))
      },

      async signOut() {
        const supabase = getSupabase()
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }
  }, [session, loading])

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
  }
  return map[message] ?? message
}
