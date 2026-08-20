import type { FormEvent } from 'react'
import { useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { isTauri } from '@/lib/platform'
import { useAuth } from './AuthProvider'

export function SignInScreen() {
  const auth = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setError(null)
    setNotice(null)
    auth.clearOAuthError()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    reset()
    setBusy(true)
    try {
      if (mode === 'signin') {
        await auth.signInWithPassword(email, password)
      } else {
        const { needsConfirm } = await auth.signUpWithPassword(email, password)
        if (needsConfirm) {
          setNotice('Fast fertig — bestätige die E-Mail, die wir dir geschickt haben.')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    reset()
    try {
      await auth.signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google-Anmeldung fehlgeschlagen')
    }
  }

  const shownError = error ?? auth.oauthError

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <CheckCircle2 size={24} className="text-accent-600" />
          <span className="text-lg font-semibold">Planner</span>
        </div>

        <h1 className="text-xl font-semibold">
          {mode === 'signin' ? 'Anmelden' : 'Konto anlegen'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Für geteilte Listen und Sync zwischen deinen Geräten.
        </p>

        {/* Google steht oben, weil es der schnellere Weg ist - ein Klick statt
            Passwort ausdenken, merken und irgendwann zurücksetzen. */}
        <button
          className="btn-outline mt-6 w-full bg-panel py-2.5"
          onClick={google}
          disabled={busy || auth.oauthPending}
        >
          {auth.oauthPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Warte auf Google …
            </>
          ) : (
            <>
              <GoogleLogo />
              Mit Google anmelden
            </>
          )}
        </button>

        {auth.oauthPending && isTauri && (
          <p className="mt-2.5 flex items-start gap-1.5 text-xs text-muted">
            <ExternalLink size={13} className="mt-0.5 shrink-0" />
            <span>
              Die Anmeldung läuft im Browser. Danach kehrt sie automatisch
              hierher zurück — dieses Fenster kann offen bleiben.
            </span>
          </p>
        )}

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
          <span className="text-xs text-muted">oder mit E-Mail</span>
          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            className="field"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="field"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="btn-primary mt-1 py-2.5" type="submit" disabled={busy}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {mode === 'signin' ? 'Anmelden' : 'Konto anlegen'}
          </button>
        </form>

        {shownError && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300">
            {shownError}
          </p>
        )}
        {notice && (
          <p className="mt-4 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800 dark:bg-accent-900/50 dark:text-accent-200">
            {notice}
          </p>
        )}

        <button
          className="mt-6 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            reset()
          }}
        >
          {mode === 'signin'
            ? 'Noch kein Konto? Registrieren'
            : 'Schon ein Konto? Anmelden'}
        </button>
      </div>
    </div>
  )
}

/**
 * Das Google-"G" als Inline-SVG.
 *
 * Bewusst nicht von einem Google-CDN geladen: die Content-Security-Policy der
 * Desktop-App erlaubt nur 'self', und ein fehlendes Logo im Anmeldeknopf sieht
 * nach kaputter App aus. Die Farben sind die offiziellen aus den
 * Google-Branding-Richtlinien.
 */
function GoogleLogo() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
