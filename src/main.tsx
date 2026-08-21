import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { HashRouter } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { App } from './App'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { RepositoryProvider } from './data/RepositoryProvider'
import { queryClient, queryPersister } from './app/queryClient'
// Mitgeliefert statt von Google geholt: Die App soll offline dieselbe Schrift
// zeigen wie online, und die CSP in tauri.conf.json laesst fremde
// Schriftquellen nicht zu. Die Datei traegt unicode-range je Sprachraum, es
// laedt also nur, was der Text wirklich braucht - fuer Deutsch 27 KB.
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import './index.css'

/**
 * HashRouter statt BrowserRouter: In der Tauri-App wird die Oberflaeche nicht
 * von einem Server ausgeliefert, sondern ueber ein eigenes Protokoll
 * (tauri://localhost bzw. http://tauri.localhost). Ein Neuladen auf
 * /list/<id> haette dort keinen Handler. Mit Hash-Routing funktioniert
 * derselbe Build im Browser, auf Windows, macOS und Android - ohne
 * Server-Rewrites.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RepositoryProvider>
        <PersistedQueryProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </PersistedQueryProvider>
      </RepositoryProvider>
    </AuthProvider>
  </StrictMode>,
)

/**
 * Der `buster` bindet den persistierten Cache an das Konto. Ohne ihn saehe
 * der naechste angemeldete Nutzer auf demselben Geraet kurz die Listen des
 * vorherigen, bevor der erste Refetch zurueckkommt.
 */
function PersistedQueryProvider({ children }: { children: ReactNode }) {
  const { mode, userId } = useAuth()

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        buster: `${mode}:${userId ?? 'anonymous'}`,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
