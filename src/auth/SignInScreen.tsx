import type { FormEvent } from 'react'
import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from './AuthProvider'

export function SignInScreen() {
  const auth = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
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

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <CheckCircle2 size={24} className="text-accent-500" />
          <span className="text-lg font-semibold">Planner</span>
        </div>

        <h1 className="text-xl font-semibold">
          {mode === 'signin' ? 'Anmelden' : 'Konto anlegen'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Für geteilte Listen und Sync zwischen deinen Geräten.
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
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

          <button className="btn-primary mt-1" type="submit" disabled={busy}>
            {mode === 'signin' ? 'Anmelden' : 'Konto anlegen'}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
          <span className="text-xs text-muted">oder</span>
          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
        </div>

        <button
          className="btn-outline w-full"
          onClick={() => {
            setError(null)
            auth.signInWithGoogle().catch((err: unknown) =>
              setError(err instanceof Error ? err.message : 'Google-Anmeldung fehlgeschlagen'),
            )
          }}
          disabled={busy}
        >
          Mit Google anmelden
        </button>

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        {notice && <p className="mt-4 text-sm text-emerald-600">{notice}</p>}

        <button
          className="mt-6 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setNotice(null)
          }}
        >
          {mode === 'signin'
            ? 'Noch kein Konto? Registrieren'
            : 'Schon ein Konto? Anmelden'}
        </button>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Google-Anmeldung braucht im Supabase-Dashboard einen konfigurierten
          Google-Provider. In der Tauri-App funktioniert der OAuth-Rücksprung erst
          mit Deep-Link-Handler — bis dahin ist E-Mail plus Passwort dort der
          verlässliche Weg.
        </p>
      </div>
    </div>
  )
}
