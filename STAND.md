# Stand der Arbeit

Übergabedokument, damit sich an einem anderen Rechner nahtlos weiterarbeiten
lässt. Was hier steht, geht über die README hinaus: sie beschreibt das
Projekt, dieses Dokument den aktuellen Zustand und die offenen Fäden.

**Letzter Stand: 20. August 2026**

> Dieses Repository ist **öffentlich**. Es stehen deshalb keine Schlüssel
> darin — nur, wo sie herkommen.

---

## Zuerst: eine Sache, die schiefgehen kann

Der Signaturschlüssel für Updates (`.tauri/planner.key`) existiert an **genau
zwei Orten**: auf dem Entwicklungsrechner und als GitHub-Secret
`TAURI_SIGNING_PRIVATE_KEY`. GitHub gibt Secrets nicht wieder heraus.

Geht der Rechner verloren, lässt sich **nie wieder ein gültiges Update
signieren** — bereits installierte Apps würden jede neue Version ablehnen.
Der einzige Ausweg wäre ein neuer Schlüssel plus manuelle Neuinstallation bei
allen Nutzern.

**Kopiere `.tauri/planner.key` in einen Passwortmanager, bevor du den Rechner
wechselst.** Die Datei ist gitignored und wandert nicht mit.

---

## Was läuft

| Bereich | Zustand |
|---|---|
| Datenbank | Migrationen 0001–0005 eingespielt, RLS aktiv und getestet |
| Web | <https://planner.sandenleif.workers.dev> — Supabase-Modus, Login aktiv |
| Eigene Domain | `planner.leifsanden.com` zeigt auf Cloudflare, **nicht verifiziert** (s.u.) |
| Desktop | v1.0.1 als GitHub-Release, macOS + Windows + Linux |
| Auth | E-Mail/Passwort funktioniert, Google **ungeprüft** (s.u.) |
| Android | Widget fertig geschrieben, **nie gebaut** (s.u.) |
| Widgets | Code steht für beide Plattformen, **nichts davon kompiliert** (s.u.) |

### Prüfen, ob die Web-Version im richtigen Modus läuft

```bash
curl -sL --compressed https://planner.sandenleif.workers.dev/assets/index-*.js | wc -c
```

Rund **615 KB** = Supabase drin, Login erscheint.
Rund **415 KB** = lokaler Modus, kein Login, jeder Besucher mit eigener
IndexedDB. Das ist schon zweimal passiert.

---

## Einrichtung auf einem neuen Rechner

```bash
git clone https://github.com/sandenleif/planner.git
cd planner
npm install
```

Danach fehlen zwei Dinge, die absichtlich nicht im Repo liegen:

**1. `.env.local`** — aus `.env.example` kopieren und füllen:

```
VITE_SUPABASE_URL=https://uzbwckjuowcexwsybtel.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-Key>
VITE_PUBLIC_APP_URL=https://planner.sandenleif.workers.dev
```

Den anon-Key gibt es hier — es ist der mit `role: anon`, **nicht** der
`service_role`-Key:
<https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel/settings/api>

**2. `.tauri/planner.key`** — nur nötig, um lokal signierte Desktop-Builds zu
erzeugen. Für Entwicklung und Web-Deploy nicht erforderlich; CI signiert
selbst.

Ohne `.env.local` startet die App im lokalen Modus. Das ist kein Fehler,
sondern der gewollte Startzustand — nur eben ohne Login und ohne Sync.

---

## Die Widgets

Beide Plattformen haben jetzt eine Ansicht, für die man die App nicht öffnen
muss. Der Code steht vollständig, **kompiliert wurde davon nichts**: auf dem
Rechner, an dem das entstanden ist, gab es weder `cargo` noch ein JDK noch das
Android-SDK. Geprüft sind nur die TypeScript-Teile (`typecheck`, `lint`,
`build` laufen durch).

### Ein Weg, zwei Ziele

`src/lib/widget.ts` rechnet einmal aus, was heute ansteht, und schickt das
Ergebnis dorthin, wo es die Plattform anzeigt: auf dem Desktop als Zahl ans
Tray-Symbol, auf Android an das Homescreen-Widget. Angestoßen wird das von
`useWidgetSync()` in der Shell des **Hauptfensters** — bewusst nicht im Panel:
das läuft in einer eigenen WebView mit eigenem Query-Cache, und zwei Absender
für dieselbe Zahl werden früher oder später uneinig.

Die Zeilen gehen **fertig formatiert** hinaus („Heute 14:30"). Sonst müsste
der Kotlin-Teil deutsche Datumsnamen und die Regel „überfällig ist alles vor
jetzt" ein zweites Mal kennen — an einer Stelle, an der niemand nachsieht,
wenn sich die Regel ändert.

### Desktop: das Panel bleibt stehen

Aus dem Menüleisten-Panel ist ein anheftbares Widget geworden. Die Stecknadel
oben rechts schaltet um; angeheftet verschwindet es nicht mehr beim Klick
daneben, merkt sich seine Position und ist nach einem Neustart wieder da.

Neu in `src-tauri/src/lib.rs`: `set_tray_badge`, `set_panel_pinned`, das
Ereignis `panel://shown` (ohne das zeigte das Panel beim Aufklappen den Stand
von vorhin — das Fenster wird nie neu montiert) und ein Menüeintrag „Panel
anzeigen" fürs Tray-Menü, weil Linux kein verlässliches Linksklick-Ereignis
für Tray-Symbole hat.

Das Panel-Fenster ist außerdem **transparent** geworden
(`tauri.conf.json`) und trägt auf macOS das Popover-Material. Vorher war es
ein randloses, eckiges, opakes Rechteck — auf macOS das sicherste Zeichen
dafür, dass etwas nicht dorthin gehört. Runde Ecken kann ein randloses Fenster
nur haben, wenn der Rest wirklich durchsichtig ist; deshalb malt der Body auf
der Panel-Route keine Farbe mehr (`.is-panel` in `index.css`).

Auf- und Zuklappen sind animiert. Ein Fenster selbst lässt sich nicht
animieren — es ist von einem Bild aufs nächste weg. Also läuft die Bewegung im
Frontend, und Rust wartet sie ab: `hide_panel_window` kündigt über
`panel://hiding` an, wartet `HIDE_DELAY` (135 ms) und versteckt dann. Ein
Zähler in `PanelState` verhindert dabei den offensichtlichen Fehler — klappt
jemand innerhalb dieser 135 ms wieder auf, lässt das wartende Verstecken das
Fenster in Ruhe.

Falls das Popover-Material auf Windows oder Linux Ärger macht: Es ist der
Block `windowEffects` am Panel-Fenster in `tauri.conf.json`, eine Zeile zum
Entfernen. Die Fläche darunter ist zu 92 % deckend, sieht ohne Material also
schlichter aus, aber nie kaputt.

Dazu kann das Panel jetzt bearbeiten: Zeile antippen klappt Titel,
Fälligkeit, Priorität und Löschen auf, eine Listenkachel führt eine Ebene
tiefer in die Liste. Der Fälligkeits-Knopf ist derselbe wie im Hauptfenster —
`DueBadge` ist dafür aus `TaskRow.tsx` in eine eigene Datei gewandert.

**Zu tun:** `npm run desktop:dev`, dann der Reihe nach: Zahl am Symbol stimmt,
Anheften hält, Position überlebt den Neustart, Aufklappen zeigt frische Daten,
Bearbeiten und Löschen im Panel greifen durch.

Ebenfalls neu und ebenfalls ungetestet: **Einstellungen → Programm** zeigt die
laufende Version und sucht auf Knopfdruck nach Updates. Das Suchen selbst ist
nur ein Abruf von `latest.json` und funktioniert auch im Entwicklungsmodus —
solange die Version in `tauri.conf.json` die des neusten veröffentlichten
Releases ist, lautet die Antwort „bereits die neuste Version". Den
**Installieren**-Knopf dort nicht ausprobieren: `tauri dev` startet die nackte
Binärdatei, es gibt kein `.app`-Bundle zum Ersetzen. Sinnvoll prüfen lässt sich
das erst mit einer installierten Version gegen ein veröffentlichtes neueres
Release.

### Android: das Homescreen-Widget

Liegt als eigenes Tauri-Plugin unter `src-tauri/plugins/planner-widget/` —
Rust-Brücke plus Gradle-Bibliothek mit Kotlin. Als Plugin und nicht als
Änderung am erzeugten Gradle-Projekt, weil `tauri android init` dieses Projekt
jederzeit neu schreiben kann; ein Plugin überlebt das.

Die Abhängigkeit steht in `src-tauri/Cargo.toml` unter
`target.'cfg(target_os = "android")'`. Ein Fehler darin kann den Desktop-Build
also nicht anfassen — und der baut die Releases.

**Nicht Jetpack Glance**, anders als in der README angekündigt, sondern
RemoteViews. Glance ist Compose, und Compose bindet den Kotlin-Compiler an eine
passende Version des Compose-Plugins — in einem Gradle-Projekt, dessen
Kotlin-Version `tauri android init` vorgibt und mit jeder Tauri-Version ändern
kann. RemoteViews kostet etwas mehr XML und hängt an nichts. Wer doch wechseln
will: `WidgetStore` bleibt, ausgetauscht werden `PlannerWidgetProvider` und
`PlannerWidgetService`.

**Der APK-Build läuft jetzt in CI.** Der Workflow hat einen Job `Android
(APK)`, der nach den Desktop-Builds läuft: er richtet JDK 17 ein, setzt
`NDK_HOME` (das Runner-Image lässt genau diese Variable aus), führt
`android:init` aus und baut ein **Debug-APK für arm64**. Das Ergebnis hängt am
Release und liegt zusätzlich als Artefakt am Workflow-Lauf.

Debug, weil ein Release-APK einen Keystore bräuchte, den es noch nicht gibt —
Gradle signiert Debug-Builds selbst. Zum Installieren auf dem Telefon reicht
das; Android fragt beim Öffnen der Datei nach der Erlaubnis für „unbekannte
Apps". Wegen `debugApplicationIdSuffix` heißt das Paket
`de.leifsanden.planner.debug` und kollidiert später nicht mit einem
Release-Build.

`gen/android` wird bewusst **nicht** eingecheckt: Es ist erzeugter Code, und
`tauri android init` schreibt ihn zur jeweils installierten Tauri-Version
passend. In CI entsteht er bei jedem Lauf neu.

Lokal geht es weiterhin so — dafür braucht es die Werkzeugkette auf dem
Rechner:

```bash
# Voraussetzungen: JDK 17, Android SDK + NDK, ANDROID_HOME, NDK_HOME
rustup target add aarch64-linux-android armv7-linux-androideabi \
                  i686-linux-android x86_64-linux-android
npm run android:init
npm run android:dev
```

Nach der Installation das Widget auf dem Homescreen ablegen und die App einmal
öffnen — vorher steht dort „App einmal öffnen", weil noch kein Schnappschuss
gespeichert ist.

Drei Stellen, an denen der erste Build erfahrungsgemäß hängt:

* **`compileSdk`/`minSdk`** in `plugins/planner-widget/android/build.gradle.kts`
  (aktuell 34 und 24) müssen zu `gen/android/app/build.gradle.kts` passen.
  Gradle sagt deutlich, wenn nicht.
* **Findet Tauri das Plugin nicht** („plugin planner-widget not found"), fehlt
  die `links`-Zeile in `plugins/planner-widget/Cargo.toml` oder
  `gen/android/tauri.settings.gradle` kennt das Modul nicht. Über `links`
  meldet das Build-Skript den Gradle-Pfad an `tauri-build` — ohne die Zeile
  baut alles durch, und das Kotlin landet trotzdem nicht im APK.
* **`planner://auth-callback` auf Android** ist nicht eingerichtet.
  `tauri.conf.json` konfiguriert das Deep-Link-Plugin nur unter `desktop`.
  Für die Google-Anmeldung auf Android braucht es dort einen `mobile`-Block
  bzw. einen Intent-Filter. Betrifft das Widget nicht — aber die Anmeldung.

### Der Sync war zu langsam — zwei Ursachen

Beide betrafen ausgerechnet das Panel, also die Stelle, an der Verzögerung am
meisten auffällt.

**Realtime hing an der geöffneten Liste.** `subscribeToList(listId)` wurde nur
von `ListPage` benutzt. Startseite, Agenda und das Panel abonnierten gar
nichts — Fremdänderungen kamen dort erst beim nächsten Refetch an, also nach
`staleTime` (30 s) plus Fensterfokus. Das Panel hat überhaupt keine geöffnete
Liste, konnte also nie etwas abonnieren. Jetzt: `subscribeToAll()`, ein Abo je
Fenster, ohne Filter. Was RLS nicht durchlässt, schickt der Server ohnehin
nicht.

**Optimistische Updates fassten nur den halben Cache an.** Alle Mutationen
schrieben in `qk.tasks(listId)`. Das Panel liest aber `qk.allTasks` — ein
Haken dort sprang deshalb erst nach dem Roundtrip um, und im lokalen Modus
sah es aus, als hinge die App. Jetzt schreiben Anlegen, Ändern und Löschen in
beide Caches (`patchTaskCaches` in `data/hooks.ts`).

Dabei ist noch ein echter Fehler mit herausgefallen: Eine im Panel angelegte
Aufgabe berechnete ihre Position (Fractional Index) gegen eine leere
Geschwisterliste, weil `tasks(listId)` dort nie geladen ist. Alle bekamen
damit denselben Schlüssel. `knownSiblings()` greift jetzt auf `allTasks`
zurück.

### Die Capabilities sind dafür aufgeteilt worden

`capabilities/default.json` enthielt `updater:default` und
`process:allow-restart`. Beide Plugins sind in `Cargo.toml` auf Desktop
beschränkt, es gibt sie auf Android also gar nicht — und eine Berechtigung für
ein nicht vorhandenes Plugin lässt den Android-Build abbrechen, bevor eine
Zeile Kotlin übersetzt wird. Jetzt: `default.json` (überall),
`desktop.json`, `panel.json`, `android.json`.

Das wäre der erste Fehler beim allerersten `android:init`-Versuch gewesen.

---

## Offene Punkte

### 1. Google-Anmeldung in der Desktop-App — ungeprüft

In v1.0.0 schlug sie fehl. Zwei Ursachen gefunden und in **v1.0.1** behoben:

* Die Capability enthielt nur `opener:allow-open-url`. Diese Berechtigung
  erlaubt den Befehl, aber **ohne Scope** — es war keine einzige URL
  zugelassen, der Aufruf von `accounts.google.com` fiel durch. Der Scope kommt
  aus `opener:allow-default-urls`.
* `app.emit()` sendet an alle Fenster. Haupt- und Panel-Fenster versuchten
  beide, denselben PKCE-Code einzulösen — der lässt sich aber nur einmal
  einlösen, das zweite Fenster bekam zwangsläufig einen Fehler. Jetzt
  `emit_to(MAIN, …)` plus eine Sperre im Frontend.

**Zu tun:** v1.0.1 installieren und Google-Anmeldung testen. Drei mögliche
Ausgänge, die auf unterschiedliche Ursachen zeigen:

| Beobachtung | Bedeutung |
|---|---|
| Läuft durch | erledigt |
| Fehlermeldung in der App | Wortlaut notieren, weitersuchen |
| Stumm bei „Warte auf Google …" | `planner://auth-callback` fehlt in Supabase (s.u.) |

### 2. Redirect-URL in Supabase — unbekannt

Unter <https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel/auth/url-configuration>
müssen stehen:

```
http://localhost:1420           Entwicklung
planner://auth-callback         Desktop und Android
https://planner.sandenleif.workers.dev
https://planner.leifsanden.com  sobald in Betrieb
```

**Von außen nicht prüfbar:** Supabase lehnt eine nicht freigegebene Adresse
nicht ab, sondern fällt still auf die Site URL zurück. Fehlt der Eintrag,
landet der Browser nach der Google-Anmeldung auf der Webseite, und die
Desktop-App wartet vergeblich.

### 3. `planner.leifsanden.com` — nicht verifiziert

Von öffentlichen DNS-Servern aus zeigt die Adresse auf Cloudflare
(`172.67.175.43`, `104.21.40.36`). Ob sie am Worker hängt, ließ sich vom
bisherigen Netz aus **nicht** prüfen: dort greift ein Webfilter, der die
Domain sperrt und Anfragen auf `secure.siloah.de:8090/…/block/webcat`
umleitet. Die `.workers.dev`-Adresse kommt durch, die eigene nicht.

**Zu tun:** Von einem anderen Netz aus aufrufen. Falls sie nicht antwortet,
im Worker unter Settings → Domains & Routes eintragen — oder den
auskommentierten `routes`-Block in `wrangler.jsonc` aktivieren.

### 4. GitHub-Token widerrufen

Für die Workflow-Datei wurde ein Fine-grained PAT verwendet und im Chat
weitergegeben. Widerrufen unter
<https://github.com/settings/personal-access-tokens>.

Für Workflow-Änderungen braucht ein Token die Berechtigung **Workflows: Read
and write**. Die auf diesem Rechner hinterlegten Zugangsdaten haben sie: Der
Android-Job in `release.yml` ließ sich am 20. August normal pushen. Der frühere
Umweg über das Einfügen von Hand ist also nicht mehr nötig — wohl aber auf
einem Rechner, dessen Token die Berechtigung nicht hat.

### 5. Kleinere offene Fäden

* **Passwort zurücksetzen** fehlt komplett. Wer sein Passwort vergisst, kommt
  nicht mehr an seine Listen.
* **Registrierung steht offen** — jeder kann ein Konto anlegen. RLS schützt
  die Daten, aber es sammeln sich fremde Konten. Abschaltbar unter
  Authentication → Providers.
* **Einladungs-E-Mails** werden nicht verschickt; der Link muss von Hand
  weitergegeben werden.
* **Drag & Drop** zum Umsortieren fehlt (`Alt+↑/↓` funktioniert). Die
  Datenseite ist fertig: `keyForIndex` in `lib/ordering.ts`.
* **Android** — Widget-Code liegt vollständig vor, das Gradle-Projekt fehlt
  noch. Ablauf oben unter „Die Widgets".
* **Haken im Android-Widget** gibt es bewusst nicht. Ein Abhaken auf dem
  Homescreen müsste die App starten, Supabase erreichen und mit
  Wiederholungsregeln umgehen — im Launcher-Prozess, ohne Netz-Garantie und
  ohne Ort für eine Fehlermeldung. Das Widget zeigt an, es schreibt nicht.
* **Offline-Schreiben** braucht PowerSync als weitere `Repository`-
  Implementierung.

---

## Fallstricke, die schon Zeit gekostet haben

Jeder Punkt hat mindestens einen fehlgeschlagenen Durchlauf verursacht.

**`npm run deploy` statt `wrangler deploy`.** Letzteres lädt hoch, was
gerade in `dist/` liegt — ohne zu prüfen, womit es gebaut wurde. So ging
zweimal eine Version ohne Login live. Das Skript baut frisch und bricht ab,
wenn die Supabase-Konfiguration nicht im Bundle steht.

**`bundle.createUpdaterArtifacts: true` muss gesetzt bleiben.** In Tauri v2
sind Updater-Artefakte opt-in. Ohne den Schalter baut alles erfolgreich
durch, aber es entsteht kein `latest.json` — Symptom im Log:
`Signature not found for the updater JSON`. Die `.sig`-Pfade in den Logs sind
dabei nur Kandidaten, keine existierenden Dateien.

**Fehlende GitHub-Secrets sind leere Strings, nicht „nicht gesetzt".**
Deshalb dürfen `APPLE_*`-Variablen nicht im `env:`-Block des Build-Schritts
stehen: Tauri prüft nur auf Anwesenheit und versucht dann, ein leeres
Zertifikat zu importieren.

**Tauri-Capabilities: `allow-*` heißt nicht „erlaubt".** Bei manchen
Berechtigungen wird nur der Befehl freigeschaltet, der zugehörige Scope kommt
aus einer zweiten Berechtigung. Bei Zweifeln in
`src-tauri/gen/schemas/acl-manifests.json` nachsehen — dort steht zu jeder
Berechtigung, was sie tatsächlich abdeckt.

**RLS-Tests müssen `INSERT … RETURNING` benutzen.** Der Client ruft
`.insert().select()` auf; daraus wird `INSERT … RETURNING`, und dafür muss
zusätzlich die SELECT-Policy greifen. Ein nacktes `INSERT` im Test läuft
durch, während die App scheitert — genau das ist passiert.

---

## Prüfen, ob alles steht

```bash
npm run typecheck    # TypeScript
npm run lint         # oxlint
npm run build        # Web-Build
npm run db:test      # 43 RLS-Prüfungen gegen Postgres im Container (braucht Docker)
```

`npm run db:test` ist der wertvollste davon: er lässt zwei Testnutzer
gegeneinander antreten und prüft, ob die Berechtigungen wirklich halten.
Läuft in einer Transaktion mit `ROLLBACK`, hinterlässt nichts.

Keiner der vier fasst Rust oder Kotlin an. Nach Änderungen an `src-tauri/`
gehört deshalb dazu:

```bash
cd src-tauri && cargo check          # Desktop
cargo check --target aarch64-linux-android   # Android, braucht das NDK
```

---

## Ein Release bauen

```bash
npm version 1.0.2 --no-git-tag-version
# Version auch in src-tauri/tauri.conf.json und src-tauri/Cargo.toml setzen
git commit -am "Version 1.0.2"
git push
git tag v1.0.2 && git push origin v1.0.2
```

Der Workflow baut macOS (beide Architekturen), Windows und Linux und legt
einen **Release-Entwurf** an. Erst nach dem Veröffentlichen sieht der Updater
ihn.

Alle vier Versionsangaben müssen übereinstimmen: `package.json`,
`tauri.conf.json`, `Cargo.toml`, `Cargo.lock`. `tauri-action` liest
`__VERSION__` aus `tauri.conf.json`.

---

## Wichtige Adressen

| | |
|---|---|
| Repo | <https://github.com/sandenleif/planner> |
| Releases | <https://github.com/sandenleif/planner/releases> |
| Actions | <https://github.com/sandenleif/planner/actions> |
| Web | <https://planner.sandenleif.workers.dev> |
| Supabase | <https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel> |
| SQL-Editor | <https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel/sql/new> |
| Auth-Provider | <https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel/auth/providers> |
| Redirect-URLs | <https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel/auth/url-configuration> |
| Security-Advisor | <https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel/advisors/security> |
| Auth-Logs | <https://supabase.com/dashboard/project/uzbwckjuowcexwsybtel/logs/auth-logs> |
