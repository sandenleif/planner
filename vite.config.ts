import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tauri setzt diese Variablen, wenn der Dev-Server aus `tauri dev` heraus
// gestartet wird. Im reinen Web-Build sind sie schlicht leer.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
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
})
