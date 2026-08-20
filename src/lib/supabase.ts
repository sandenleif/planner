import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase-Client - oder null, wenn die App noch nicht konfiguriert ist.
 *
 * Ohne .env laeuft die App absichtlich weiter, nur eben gegen das
 * LocalRepository (IndexedDB, ein Geraet). So kann man sie sofort starten und
 * ausprobieren, bevor ueberhaupt ein Supabase-Projekt existiert.
 */

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseConfigured = Boolean(url && anonKey)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // PKCE ist der Flow, der auch in einer WebView ohne eigenen
        // Browser-Kontext sauber funktioniert - also in Tauri auf Desktop
        // und Android.
        flowType: 'pkce',
        detectSessionInUrl: true,
      },
      realtime: {
        // Reicht fuer eine Handvoll geteilter Listen und haelt die
        // Verbindung ruhig.
        params: { eventsPerSecond: 5 },
      },
    })
  }
  return client
}

/** Wirft, statt null zurueckzugeben - fuer Stellen, die ohne Client sinnlos sind. */
export function requireSupabase(): SupabaseClient {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error(
      'Supabase ist nicht konfiguriert. VITE_SUPABASE_URL und ' +
        'VITE_SUPABASE_ANON_KEY in .env.local setzen.',
    )
  }
  return supabase
}
