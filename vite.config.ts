import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tauri setzt diese Variablen, wenn der Dev-Server aus `tauri dev` heraus
// gestartet wird. Im reinen Web-Build sind sie schlicht leer.
const host = process.env.TAURI_DEV_HOST

/**
 * Verhindert, dass versehentlich eine Fassung ohne Login gebaut wird.
 *
 * Vite ersetzt VITE_*-Variablen zur Buildzeit. Fehlen sie, faltet es
 * `supabaseConfigured` zu false, wirft supabase-js komplett heraus und
 * erzeugt eine App im lokalen Modus: kein Login, jeder Besucher mit seiner
 * eigenen leeren Datenbank im Browser. Der Build schlaegt dabei NICHT fehl —
 * das Ergebnis sieht aus wie die richtige App.
 *
 * Genau das ist dreimal passiert, zuletzt von einem Rechner ohne `.env.local`
 * (die Datei ist gitignored und wandert nicht mit). Deshalb bricht der
 * Produktionsbuild jetzt ab, statt still das Falsche zu bauen.
 *
 * Bewusst nur beim Bauen, nicht beim Entwickeln: `npm run dev` soll ohne jede
 * Einrichtung starten — das ist der gewollte Startzustand.
 *
 * Absichtlich ohne Login bauen: `PLANNER_ALLOW_LOCAL_BUILD=1` setzen, oder
 * `npm run deploy -- --local`, das setzt es selbst.
 */
function pruefeSupabaseKonfiguration(mode: string): void {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_ANON_KEY?.trim()

  if (url && key) return

  if (process.env.PLANNER_ALLOW_LOCAL_BUILD) {
    console.warn('\n! Build ohne Supabase — die Fassung hat keinen Login.\n')
    return
  }

  const fehlend = [!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_ANON_KEY']
    .filter(Boolean)
    .join(' und ')

  throw new Error(
    [
      '',
      `Produktionsbuild abgebrochen: ${fehlend} fehlt.`,
      '',
      'Ohne diese Werte entsteht eine App OHNE LOGIN — die Daten landen nur im',
      'Browser des jeweiligen Besuchers. Der Build wuerde sonst durchlaufen und',
      'das Falsche ausliefern, ohne dass irgendetwas fehlschlaegt.',
      '',
      'Auf einem neuen Rechner: .env.example nach .env.local kopieren und',
      'ausfuellen (Anleitung in STAND.md). In CI: die Secrets pruefen.',
      '',
      'Wirklich ohne Login bauen: PLANNER_ALLOW_LOCAL_BUILD=1',
      '',
    ].join('\n'),
  )
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') pruefeSupabaseKonfiguration(mode)

  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    // Tauri erwartet einen festen Port und uebernimmt die Fehlerausgabe selbst.
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      // Auf Android laeuft die WebView auf dem Geraet und muss den Dev-Server
      // ueber das Netzwerk erreichen - deshalb host aus TAURI_DEV_HOST.
      host: host || false,
      hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },

    // Alles unter VITE_ landet im Client-Bundle. TAURI_ENV_* braucht der
    // Tauri-Build fuer Plattform-Weichen.
    envPrefix: ['VITE_', 'TAURI_ENV_'],

    build: {
      // Android-WebViews sind aelter als Desktop-Browser - Chrome 108 ist der
      // Stand, den Tauri v2 als Untergrenze fuer Android annimmt.
      target:
        process.env.TAURI_ENV_PLATFORM === 'windows'
          ? 'chrome110'
          : process.env.TAURI_ENV_PLATFORM === 'android'
            ? 'chrome108'
            : 'safari15',
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      // true = der Standard-Minifier dieser Vite-Version (oxc). Nicht auf
      // 'esbuild' festnageln - Vite 8 bringt esbuild nicht mehr mit.
      minify: !process.env.TAURI_ENV_DEBUG,
    },
  }
})
