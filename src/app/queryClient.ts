import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'

/**
 * Query-Cache samt Persistenz in IndexedDB.
 *
 * Das ist die erste Ausbaustufe von "offline": beim Start sind die zuletzt
 * gesehenen Daten sofort da, statt eines Ladebalkens. Schreiben braucht
 * weiterhin Netz - der echte Offline-Schreibpfad kommt spaeter mit PowerSync,
 * und zwar hinter dem Repository-Interface, ohne dass diese Datei sich aendert.
 *
 * localStorage waere der einfachere Weg, ist aber synchron und blockiert damit
 * den Main-Thread - auf Android beim Start deutlich spuerbar.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Kurz genug, dass Aenderungen anderer Geraete zeitnah ankommen, lang
      // genug, dass Navigieren zwischen Listen nicht dauernd nachlaedt.
      staleTime: 30_000,
      // Der persistierte Cache soll einen Neustart ueberleben.
      gcTime: 1000 * 60 * 60 * 24 * 7,
      retry: (failureCount, error) => {
        // Bei Berechtigungsfehlern bringt Wiederholen nichts.
        const message = error instanceof Error ? error.message : ''
        if (/permission|policy|JWT|not authorized/i.test(message)) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
})

export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: 'planner:query-cache',
  throttleTime: 1_000,
})
