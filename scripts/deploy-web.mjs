#!/usr/bin/env node
/**
 * Baut und veröffentlicht die Web-Version auf Cloudflare Workers.
 *
 * Warum ein Skript statt `wrangler deploy`? Weil `wrangler deploy` hochlädt,
 * was gerade in `dist/` liegt — ohne zu fragen, wann und womit das gebaut
 * wurde. Ein alter Ordner, ein Build ohne `.env.local`, und die
 * ausgelieferte App läuft im lokalen Modus: kein Login, jeder Besucher mit
 * seiner eigenen leeren Datenbank im Browser. Fehlschlagen tut dabei nichts.
 *
 * Genau das ist einmal passiert. Deshalb prüft dieses Skript nach dem Build
 * und VOR dem Hochladen, ob die Supabase-Konfiguration wirklich im Bundle
 * steht — und bricht sonst ab.
 *
 *   npm run deploy            bauen, prüfen, hochladen
 *   npm run deploy -- --local bewusst ohne Supabase (kein Login)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const erlaubtLokal = process.argv.includes('--local')

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })

/** Liest .env.local, ohne eine Abhängigkeit dafür einzuziehen. */
function readEnvLocal() {
  const path = join(ROOT, '.env.local')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
      }),
  )
}

const env = readEnvLocal()
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

if (!erlaubtLokal && (!url || !key)) {
  console.error('\n✗ In .env.local fehlt VITE_SUPABASE_URL oder VITE_SUPABASE_ANON_KEY.')
  console.error('  Ein Deploy daraus liefe im lokalen Modus - ohne Login, ohne Sync.')
  console.error('  Wenn das wirklich gewollt ist: npm run deploy -- --local\n')
  process.exit(1)
}

// Immer frisch bauen. Ein vorhandenes dist/ sagt nichts darueber aus, womit
// es gebaut wurde.
console.log('Baue neu …\n')
rmSync(join(ROOT, 'dist'), { recursive: true, force: true })
run('npm', ['run', 'build'])

// --------------------------------------------------------------- Kontrolle

const assets = join(ROOT, 'dist', 'assets')
const bundleName = readdirSync(assets).find((f) => f.startsWith('index-') && f.endsWith('.js'))
if (!bundleName) {
  console.error('\n✗ Kein JavaScript-Bundle in dist/assets gefunden.')
  process.exit(1)
}

const bundle = readFileSync(join(assets, bundleName), 'utf8')
const hatUrl = url ? bundle.includes(url.replace(/^https?:\/\//, '')) : false
const hatClient = bundle.includes('GoTrueClient')

console.log('')
console.log('Bundle    :', bundleName, '(' + Math.round(bundle.length / 1024) + ' KB)')
console.log('Supabase  :', hatClient ? 'einkompiliert' : 'NICHT enthalten')
console.log('Projekt   :', hatUrl ? 'URL gefunden' : 'URL nicht gefunden')

if (!erlaubtLokal && !(hatUrl && hatClient)) {
  console.error('\n✗ Das Bundle enthaelt die Supabase-Konfiguration nicht.')
  console.error('  Vite ersetzt VITE_*-Variablen zur Buildzeit; fehlen sie, faltet es')
  console.error('  supabaseConfigured zu false und wirft supabase-js komplett heraus.')
  console.error('  Es wird NICHT hochgeladen.\n')
  process.exit(1)
}

if (erlaubtLokal) {
  console.log('\n! Deploy im lokalen Modus (--local): die Seite hat keinen Login.')
}

// ----------------------------------------------------------------- Hochladen

console.log('\nLade hoch …\n')
run('npx', ['wrangler', 'deploy'])

console.log('\n✓ Fertig. Gegenprobe der ausgelieferten Fassung:')
console.log('  curl -sL --compressed https://<domain>/assets/index-*.js | wc -c')
console.log('  Rund 615 KB = Supabase drin, rund 415 KB = lokaler Modus.')
