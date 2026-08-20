/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** z. B. https://xyzcompany.supabase.co - leer lassen fuer den Local-Modus. */
  readonly VITE_SUPABASE_URL?: string
  /** Der oeffentliche anon-Key. Gehoert ins Frontend, RLS schuetzt die Daten. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Basis-URL fuer Einladungslinks, z. B. https://planner.example.com */
  readonly VITE_PUBLIC_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
