import { createContext, use, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { getSupabase } from '@/lib/supabase'
import { LocalRepository } from './localRepository'
import { SupabaseRepository } from './supabaseRepository'
import type { Repository } from './repository'

/**
 * Waehlt zur Laufzeit die passende Repository-Implementierung.
 *
 * Genau hier zahlt sich das Interface aus: eine weitere Implementierung
 * (PowerSync, eigener Server) waere ein zusaetzlicher Zweig in dieser
 * Funktion - und sonst nichts.
 */

const RepositoryContext = createContext<Repository | null>(null)

// Eine Instanz pro Tab. Das LocalRepository haelt den Datenstand im Speicher,
// deshalb darf es nicht bei jedem Render neu entstehen.
let localSingleton: LocalRepository | null = null

function getLocalRepository(): LocalRepository {
  localSingleton ??= new LocalRepository()
  return localSingleton
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const { mode, userId } = useAuth()

  const repository = useMemo<Repository>(() => {
    const supabase = getSupabase()

    if (mode === 'supabase' && supabase && userId) {
      return new SupabaseRepository(supabase, userId)
    }
    return getLocalRepository()
  }, [mode, userId])

  return <RepositoryContext value={repository}>{children}</RepositoryContext>
}

export function useRepository(): Repository {
  const repo = use(RepositoryContext)
  if (!repo) throw new Error('useRepository muss innerhalb von <RepositoryProvider> stehen')
  return repo
}
