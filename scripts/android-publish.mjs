#!/usr/bin/env node
/**
 * Bringt den fertigen Android-Build ans Release — mit brauchbaren Dateinamen
 * und einem Eintrag im Update-Manifest.
 *
 * Nicht zu verwechseln mit scripts/android-release.mjs: Das richtet VOR dem
 * Bauen die Signatur im erzeugten Gradle-Projekt ein. Dieses hier läuft
 * DANACH und tut zwei Dinge, die die CI sonst nicht täte:
 *
 * 1. Gradle nennt das Ergebnis `app-universal-release.apk`. Als Datei, die
 *    jemand aus einem Release herunterlädt, ist das ein schlechter Name: Er
 *    nennt weder das Programm noch die Version, und im Download-Ordner liegen
 *    davon irgendwann fünf. Hier wird daraus `Planner_1.0.6_universal.apk`.
 *
 * 2. `latest.json` erzeugt tauri-action, und das kennt nur die Desktop-Bundles.
 *    Ohne einen Android-Eintrag findet die App auf dem Telefon nie eine neuere
 *    Fassung — sie liest dasselbe Manifest wie Windows und macOS. Deshalb wird
 *    es hier geholt, ergänzt und zurückgelegt.
 *
 * Aufruf (in .github/workflows/release.yml):
 *
 *   node scripts/android-publish.mjs --tag v1.0.6 --signed
 *   node scripts/android-publish.mjs                  # nur benennen
 *
 * Ohne `--tag` werden die Dateien nur umbenannt — der Fall workflow_dispatch,
 * in dem es kein Release gibt, an das sich etwas hängen ließe.
 *
 * Ohne `--signed` unterbleibt der Manifest-Eintrag. Ein Debug-APK dort
 * einzutragen wäre schlimmer als gar keiner: Es trägt einen anderen
 * Signaturschlüssel, und jedes Gerät, das es als Update annehmen wollte,
 * bekäme INSTALL_FAILED_UPDATE_INCOMPATIBLE.
 */

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = join(ROOT, 'dist-android')

/**
 * Muss zu ANDROID_PLATFORM in src/lib/updater.ts passen — und darf keinem der
 * Schlüssel gleichen, die Tauri selbst vergibt (`windows-x86_64`,
 * `darwin-aarch64`, `linux-x86_64` und so fort).
 */
const PLATFORM_KEY = 'android-universal'

const REPO = 'sandenleif/planner'

// ------------------------------------------------------------------- Aufruf

const args = process.argv.slice(2)
const tag = valueOf('--tag')
const signed = args.includes('--signed')

function valueOf(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const gh = (...parameters) =>
  execFileSync('gh', parameters, { cwd: ROOT, encoding: 'utf8' })

// --------------------------------------------------------------- Umbenennen

const version = JSON.parse(
  readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
).version

const built = findArtifacts(join(ROOT, 'src-tauri', 'gen', 'android'))

if (built.length === 0) {
  console.error('\n✗ Kein APK und kein AAB gefunden. Ist der Build durchgelaufen?\n')
  process.exit(1)
}

mkdirSync(OUTPUT_DIR, { recursive: true })

const renamed = built.map((source) => {
  const { variant, debug, suffix } = describe(source)

  // Die Variante gehört in den Namen, nicht nur "universal": Sobald jemand
  // --split-per-abi baut, entstehen mehrere APKs, und ein fester Name ließe
  // sie im Zielordner übereinander purzeln. Debug kommt dazu, damit sichtbar
  // bleibt, dass diese Fassung sich später nicht aktualisieren lässt.
  const target = join(
    OUTPUT_DIR,
    `Planner_${version}_${debug ? 'debug-' : ''}${variant}.${suffix}`,
  )

  copyFileSync(source, target)
  console.log(
    `${(statSync(source).size / 1024 / 1024).toFixed(1).padStart(6)} MB  ${basename(target)}`,
  )
  return { path: target, variant, debug, suffix }
})

if (!tag) {
  console.log('\nKein --tag: Es gibt kein Release, an das sich etwas hängen ließe.')
  process.exit(0)
}

// ---------------------------------------------------------------- Anhängen

console.log('\nHänge an das Release …')
gh('release', 'upload', tag, ...renamed.map((file) => file.path), '--clobber', '--repo', REPO)

if (!signed) {
  console.log(
    [
      '',
      '! Nicht signiert — kein Eintrag in latest.json.',
      '  Ein Debug-APK trägt einen anderen Schlüssel und lässt sich nicht über',
      '  eine installierte Fassung legen. Es als Update anzubieten, führte auf',
      '  jedem Gerät zu INSTALL_FAILED_UPDATE_INCOMPATIBLE.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

// -------------------------------------------------------------- latest.json

// Das universelle APK, nicht irgendeines: Ein Manifest-Eintrag zeigt auf genau
// eine Datei, und die muss auf jedem Gerät laufen. Ein arm64-APK würde auf
// älteren Telefonen abgelehnt - erst beim Installieren, nach dem Download.
const apk = renamed.find((file) => file.suffix === 'apk' && file.variant === 'universal')

if (!apk) {
  const gefunden = renamed.map((file) => basename(file.path)).join(', ') || 'nichts'
  console.error('\n✗ Kein universelles APK gefunden. Vorhanden:', gefunden)
  console.error('  Wurde mit --split-per-abi gebaut? Dann braucht latest.json')
  console.error('  je Architektur einen eigenen Eintrag - und die App muss')
  console.error('  wissen, welcher ihrer ist.\n')
  process.exit(1)
}

const manifestPath = join(OUTPUT_DIR, 'latest.json')

console.log('\nHole latest.json vom Release …')
try {
  gh(
    'release',
    'download',
    tag,
    '--pattern',
    'latest.json',
    '--dir',
    OUTPUT_DIR,
    '--clobber',
    '--repo',
    REPO,
  )
} catch (error) {
  console.error('\n✗ latest.json ließ sich nicht holen.')
  console.error('  Erzeugt wird es vom Desktop-Build (includeUpdaterJson). Fehlt es,')
  console.error('  ist der Job "build" nicht durchgelaufen — dann fehlt das Update')
  console.error('  auch für Windows und macOS, nicht nur für Android.')
  console.error(String(error.stderr || error.message))
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.platforms ??= {}

manifest.platforms[PLATFORM_KEY] = {
  url: `https://github.com/${REPO}/releases/download/${tag}/${basename(apk.path)}`,

  // Absichtlich leer, und nicht vergessen.
  //
  // Auf dem Desktop prüft der Tauri-Updater hier eine minisign-Signatur, weil
  // Windows und macOS nichts dagegen hätten, ein fremdes Programm über das
  // eigene zu schreiben. Auf Android macht diese Prüfung das System selbst und
  // schärfer: Es vergleicht das Signaturzertifikat des APK mit dem der
  // installierten App und lehnt jede Abweichung ab. Eine zweite Signatur
  // prüfte dieselbe Eigenschaft ein zweites Mal.
  //
  // Das Feld muss trotzdem dastehen: Der Desktop-Updater liest das ganze
  // Manifest in einem Zug, und `signature` ist dort ein Pflichtfeld. Fehlte es
  // an EINEM Eintrag, scheiterte das Lesen der ganzen Datei — und Windows und
  // macOS bekämen wegen des Android-Eintrags keine Updates mehr.
  signature: '',
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log('Eingetragen:', manifest.platforms[PLATFORM_KEY].url)

gh('release', 'upload', tag, manifestPath, '--clobber', '--repo', REPO)

console.log('\n✓ Fertig. Plattformen im Manifest:', Object.keys(manifest.platforms).join(', '))

// ------------------------------------------------------------------- Helfer

/**
 * Sucht die Bauergebnisse. Gradle legt sie je nach Variante unterschiedlich ab,
 * deshalb wird gesucht statt geraten — ein fester Pfad stimmte schon beim
 * Wechsel von debug auf release nicht mehr.
 */
function findArtifacts(directory) {
  const found = []

  const walk = (current) => {
    if (!existsSync(current)) return

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)

      if (entry.isDirectory()) {
        walk(path)
      } else if (entry.name.endsWith('.apk') || entry.name.endsWith('.aab')) {
        // Zwischenergebnis aus dem Signierlauf, kein fertiges Paket.
        if (entry.name.includes('unsigned')) continue
        found.push(path)
      }
    }
  }

  walk(directory)
  return found
}

/**
 * Zerlegt einen Gradle-Namen wie `app-universal-release.apk`.
 *
 * Passt das Muster nicht — weil ein künftiges Android-Gradle-Plugin anders
 * benennt —, wird nicht geraten: Die Variante heißt dann "unbekannt", und der
 * Manifest-Eintrag weiter oben findet kein universelles APK und bricht mit
 * einer Meldung ab. Das ist der gewollte Ausgang. Stillschweigend
 * "universal" anzunehmen hieße, möglicherweise ein arm64-APK als Update für
 * alle Geräte anzubieten.
 */
function describe(file) {
  const name = basename(file)
  const match = name.match(/^app-(.+)-(debug|release)\.(apk|aab)$/)

  if (!match) {
    return {
      variant: 'unbekannt',
      debug: name.includes('debug'),
      suffix: name.endsWith('.aab') ? 'aab' : 'apk',
    }
  }

  return { variant: match[1], debug: match[2] === 'debug', suffix: match[3] }
}

function basename(path) {
  return path.split(/[\\/]/).pop()
}
