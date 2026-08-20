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
 * Zwei Dinge kommen hinzu:
 *
 * 1. **Signatur.** Ohne sie entsteht ein Debug-APK, signiert mit dem
 *    Wegwerf-Schlüssel, den Gradle sich selbst erzeugt. Zum Ausprobieren
 *    reicht das; für etwas, das Nutzer behalten und aktualisieren sollen,
 *    nicht: Android akzeptiert eine Aktualisierung nur, wenn sie mit
 *    demselben Schlüssel signiert ist wie die installierte Version.
 *
 * 2. **Der OAuth-Rückweg.** Google schickt den Browser nach der Anmeldung auf
 *    `planner://auth-callback`. Damit Android weiß, dass diese Adresse zu
 *    dieser App gehört, braucht die Activity einen Intent-Filter. Der
 *    Deep-Link-Plugin-Block in tauri.conf.json deckt das nicht ab: dessen
 *    `mobile`-Abschnitt ist für App Links (https) gedacht, nicht für eigene
 *    Schemata.
 *
 * Ohne die Umgebungsvariablen tut das Skript nichts und meldet das. Ein
 * Debug-Build bleibt damit jederzeit möglich, auch ohne Zugriff auf die
 * Schlüssel.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ANDROID_DIR = resolve('src-tauri/gen/android')
const GRADLE_FILE = resolve(ANDROID_DIR, 'app/build.gradle.kts')
const MANIFEST_FILE = resolve(ANDROID_DIR, 'app/src/main/AndroidManifest.xml')
const KEYSTORE_FILE = resolve(ANDROID_DIR, 'upload-keystore.p12')
const PROPERTIES_FILE = resolve(ANDROID_DIR, 'keystore.properties')

/** Das Schema, auf das Supabase nach der Google-Anmeldung zurückspringt. */
const DEEP_LINK_SCHEME = 'planner'

function main() {
  if (!existsSync(ANDROID_DIR)) {
    fail(
      `${ANDROID_DIR} fehlt. Erst "npm run android:init" ausführen — das Skript ` +
        'richtet ein vorhandenes Projekt her, es erzeugt keines.',
    )
  }

  addDeepLinkIntentFilter()

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

// ------------------------------------------------------------------ Deep-Link

function addDeepLinkIntentFilter() {
  const manifest = readFileSync(MANIFEST_FILE, 'utf8')

  if (manifest.includes(`android:scheme="${DEEP_LINK_SCHEME}"`)) {
    console.log('Intent-Filter für planner:// steht bereits im Manifest.')
    return
  }

  const anchor = '</activity>'
  const at = manifest.indexOf(anchor)
  if (at === -1) {
    fail(
      `Kein </activity> in ${MANIFEST_FILE} gefunden. Der Tauri-Generator hat ` +
        'das Manifest umgebaut — der Intent-Filter muss von Hand hinein, sonst ' +
        'läuft die Google-Anmeldung auf Android ins Leere.',
    )
  }

  const filter = `
            <!-- Rueckweg aus der Google-Anmeldung. Ohne diesen Filter kennt
                 Android das Schema nicht, der Browser bleibt auf einer leeren
                 Seite stehen und die App wartet vergeblich. Eingefuegt von
                 scripts/android-release.mjs, weil gen/android erzeugter Code
                 ist und bei jedem init neu entsteht. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${DEEP_LINK_SCHEME}" />
            </intent-filter>
        `

  writeFileSync(MANIFEST_FILE, manifest.slice(0, at) + filter + manifest.slice(at))
  console.log(`Intent-Filter für ${DEEP_LINK_SCHEME}:// ins Manifest eingefügt.`)
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
