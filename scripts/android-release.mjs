#!/usr/bin/env node
/**
 * Richtet das erzeugte Android-Projekt für einen Release-Build her.
 *
 * Warum ein Skript und keine eingecheckte Datei: `src-tauri/gen/android` ist
 * erzeugter Code. `tauri android init` schreibt ihn zur jeweils installierten
 * Tauri-Version passend und überschreibt dabei alles. Was dauerhaft gelten
 * soll, muss also nach jedem init erneut hineingeschrieben werden — und genau
 * das tut diese Datei.
 *
 * Konkret geht es um die **Signatur**. Ohne sie entsteht ein Debug-APK,
 * signiert mit dem Wegwerf-Schlüssel, den Gradle sich selbst erzeugt. Zum
 * Ausprobieren reicht das; für etwas, das Nutzer behalten und aktualisieren
 * sollen, nicht: Android akzeptiert eine Aktualisierung nur, wenn sie mit
 * demselben Schlüssel signiert ist wie die installierte Version.
 *
 * Der OAuth-Rückweg stand hier eine Version lang mit drin, als von Hand
 * eingefügter Intent-Filter. Der landete auch im APK und half trotzdem nicht:
 * Das Deep-Link-Plugin prüft jeden ankommenden Intent zusätzlich gegen seine
 * eigene Konfiguration und verwirft ihn, solange `plugins.deep-link.mobile`
 * leer ist. Der Eintrag dort erledigt jetzt beides — den Filter im Manifest
 * und die Annahme zur Laufzeit.
 *
 * Ohne die Umgebungsvariablen tut das Skript nichts und meldet das. Ein
 * Debug-Build bleibt damit jederzeit möglich, auch ohne Zugriff auf die
 * Schlüssel.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ANDROID_DIR = resolve('src-tauri/gen/android')
const GRADLE_FILE = resolve(ANDROID_DIR, 'app/build.gradle.kts')
const KEYSTORE_FILE = resolve(ANDROID_DIR, 'upload-keystore.p12')
const PROPERTIES_FILE = resolve(ANDROID_DIR, 'keystore.properties')

function main() {
  if (!existsSync(ANDROID_DIR)) {
    fail(
      `${ANDROID_DIR} fehlt. Erst "npm run android:init" ausführen — das Skript ` +
        'richtet ein vorhandenes Projekt her, es erzeugt keines.',
    )
  }

  const signed = configureSigning()
  report(signed)
}

// ------------------------------------------------------------------ Signatur

function configureSigning() {
  const base64 = process.env.ANDROID_KEYSTORE_BASE64
  const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD
  const keyAlias = process.env.ANDROID_KEY_ALIAS
  // Bei einem mit openssl erzeugten PKCS12 sind Store- und Schlüsselpasswort
  // dasselbe; getrennt setzen kann man es trotzdem.
  const keyPassword = process.env.ANDROID_KEY_PASSWORD ?? storePassword

  if (!base64) {
    console.log(
      'ANDROID_KEYSTORE_BASE64 ist nicht gesetzt — es bleibt beim Debug-Build.',
    )
    return false
  }

  if (!storePassword || !keyAlias) {
    fail(
      'ANDROID_KEYSTORE_BASE64 ist gesetzt, aber ANDROID_KEYSTORE_PASSWORD oder ' +
        'ANDROID_KEY_ALIAS fehlt. Halb konfiguriert ist schlimmer als gar nicht: ' +
        'Gradle signierte sonst still mit dem Debug-Schlüssel weiter.',
    )
  }

  const keystore = Buffer.from(base64, 'base64')
  // Ein PKCS12 beginnt mit einer DER-Sequenz (0x30). Kommt hier etwas anderes
  // an, wurde beim Kopieren des Secrets etwas abgeschnitten - ein Fehler, der
  // sonst erst Gradle auffiele, und zwar mit einer unverständlichen Meldung.
  if (keystore.length < 100 || keystore[0] !== 0x30) {
    fail(
      `ANDROID_KEYSTORE_BASE64 ergibt keine gültige Keystore-Datei (${keystore.length} Bytes). ` +
        'Beim Anlegen des Secrets vermutlich Zeilenumbrüche verloren gegangen.',
    )
  }

  writeFileSync(KEYSTORE_FILE, keystore)

  // Gradle liest diese Datei über den Block, der unten angehängt wird. Sie
  // steht in .gitignore und entsteht nur zur Build-Zeit.
  writeFileSync(
    PROPERTIES_FILE,
    [
      'storeFile=upload-keystore.p12',
      `storePassword=${storePassword}`,
      `keyAlias=${keyAlias}`,
      `keyPassword=${keyPassword}`,
      '',
    ].join('\n'),
  )

  appendSigningBlock()
  return true
}

/**
 * Hängt die Signatur-Konfiguration an build.gradle.kts an.
 *
 * Anhängen statt Ersetzen: `android { }` ist nur ein Funktionsaufruf, der die
 * Erweiterung konfiguriert — ein zweiter Block ergänzt den ersten. Damit
 * braucht das Skript keine Stelle im erzeugten Code zu treffen, und ein
 * geänderter Tauri-Generator kann es nicht kaputt machen.
 *
 * Die Java-Klassen stehen voll qualifiziert da, damit oben keine import-Zeile
 * eingefügt werden muss — die dürfte in Kotlin nicht am Dateiende stehen.
 */
function appendSigningBlock() {
  const existing = readFileSync(GRADLE_FILE, 'utf8')
  if (existing.includes('PLANNER_SIGNING')) {
    console.log('Signatur-Block steht bereits in build.gradle.kts.')
    return
  }

  appendFileSync(
    GRADLE_FILE,
    `

// --- PLANNER_SIGNING (scripts/android-release.mjs) ---
val plannerKeystoreProperties = java.util.Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) {
        java.io.FileInputStream(file).use { load(it) }
    }
}

android {
    signingConfigs {
        create("planner") {
            storeFile = rootProject.file(plannerKeystoreProperties["storeFile"] as String)
            storePassword = plannerKeystoreProperties["storePassword"] as String
            keyAlias = plannerKeystoreProperties["keyAlias"] as String
            keyPassword = plannerKeystoreProperties["keyPassword"] as String
            // Von openssl erzeugte Keystores sind PKCS12. Ohne diese Zeile
            // raet Gradle anhand der Dateiendung und faellt bei .p12 auf JKS
            // zurueck - mit einer Fehlermeldung, die nach kaputtem Passwort
            // aussieht statt nach falschem Format.
            storeType = "PKCS12"
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("planner")
        }
    }
}
`,
  )
  console.log('Signatur-Block an build.gradle.kts angehängt.')
}

// ------------------------------------------------------------------- Ausgabe

function report(signed) {
  console.log(
    signed
      ? 'Release-Signatur eingerichtet — es entsteht ein signiertes APK/AAB.'
      : 'Ohne Signatur — es entsteht ein Debug-APK.',
  )

  // Der Workflow entscheidet daran, ob er --debug baut.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `signed=${signed}\n`)
  }
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

main()
