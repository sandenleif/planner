# Planner

Eine To-do-App mit geteilten Listen — im Browser, auf Windows, macOS und Android.

Eine Codebase (React + TypeScript), drei Auslieferungswege: der Vite-Build ist
die Web-App, Tauri v2 verpackt denselben Build als Desktop-Programm und als
Android-APK.

**Aktueller Arbeitsstand, offene Punkte und Fallstricke: [STAND.md](STAND.md).**

## Sofort starten

```bash
npm install
npm run dev
```

Läuft ohne jede weitere Einrichtung auf <http://localhost:1420> — im **lokalen
Modus**: kein Login, alle Daten in IndexedDB auf diesem Gerät, mit
Beispieldaten befüllt. Geteilte Listen und Sync brauchen Supabase (siehe unten).

## Was drin ist

**Aufgaben mit Unterpunkten**, beliebig tief.
`Tab` rückt ein · `Shift+Tab` aus · `Enter` legt die nächste an ·
`Alt+↑/↓` verschiebt · `Backspace` auf leerer Zeile löscht.

**Schnellerfassung, die mitdenkt.** Das Eingabefeld liest Datum, Priorität und
Wiederholung direkt aus dem Text und zeigt vorher an, was es verstanden hat:

| Eingabe | Ergebnis |
|---|---|
| `Steuer machen morgen !!` | morgen fällig, Priorität mittel |
| `Müll rausbringen jeden montag` | nächster Montag, wöchentlich |
| `Anruf Chef am 5.12. um 14:30` | 5. Dezember, 14:30 Uhr |
| `Bericht in 3 tagen !!!` | in 3 Tagen, Priorität hoch |

Versteht außerdem `heute`, `übermorgen`, `nächste woche`, `werktags`,
`monatlich`, `jährlich` und Wochentagsnamen.

**Wiederkehrende Aufgaben.** Beim Abhaken entsteht automatisch die nächste
Fälligkeit — die erledigte bleibt als Historie stehen.

**Suche über alles** mit `Strg`/`Cmd`+`K`: Aufgaben, Notizen und Listen,
Pfeiltasten zum Wählen, Enter zum Springen.

**Heute und Demnächst** — listenübergreifende Agenda, nach Tagen gruppiert,
Überfälliges zuoberst.

**Geteilte Listen** — Einladung per E-Mail, Rollen Besitzer/Bearbeiten/Lesen,
Live-Sync über Supabase Realtime. Das Abo hängt an allen sichtbaren Listen,
nicht an der geöffneten: sonst bekämen Startseite, Agenda und das
Menüleisten-Panel Fremdänderungen erst beim nächsten Refetch mit.

**Rückgängig statt Rückfrage.** Gelöschte Aufgaben lassen sich aus der
Meldung heraus zurückholen, samt Unterpunkten.

**Details je Aufgabe**: Notizen, Priorität, Wiederholung.

**Desktop-Integration** — Tray-Symbol mit der Anzahl dessen, was heute ansteht,
Schließen versteckt statt beendet, `Strg+Umschalt+Leertaste` klappt das Panel
von überall auf.

**Ein Panel, das bleiben darf.** Aus dem Tray-Symbol klappt eine kurze Ansicht
auf: was heute fällig ist, ein Feld zum Notieren, die Listen mit ihren Zahlen.
Die Stecknadel oben rechts heftet es an — dann verschwindet es nicht mehr beim
Klick daneben, merkt sich seine Position und ist nach dem Neustart wieder da.

**Homescreen-Widget auf Android** — dieselbe Übersicht als App-Widget: was
heute fällig ist, Listenfarbe je Zeile, Tippen öffnet die App.

## Supabase einrichten

1. Projekt auf <https://supabase.com> anlegen (Free Tier reicht lange).
2. Die Migrationen aus `supabase/migrations/` **in dieser Reihenfolge** im
   SQL-Editor ausführen:
   - `0001_schema.sql` — Tabellen, Indizes, Trigger
   - `0002_rls.sql` — Row Level Security, das Herzstück der geteilten Listen
   - `0003_realtime.sql` — Live-Sync einschalten
   - `0004_function_privileges.sql` — Ausführungsrechte und `search_path`
3. `.env.example` nach `.env.local` kopieren und Project URL plus anon-Key
   eintragen (Dashboard → Settings → API).
4. `npm run dev` neu starten. Jetzt erscheint der Anmeldebildschirm.

Wer die Supabase CLI nutzt: `supabase db push` spielt denselben Ordner ein.

### Nachweisen, dass die Berechtigungen halten

„RLS ist aktiviert" ist keine Aussage über Sicherheit — eine Policy kann
existieren und trotzdem zu weit sein. `supabase/tests/rls_test.sql` beantwortet
die Frage stattdessen praktisch: Es legt zwei Testnutzer an, lässt sie
gegeneinander antreten und prüft 39 Regeln — sieht Bob Alices Aufgaben? Kann
er in ihre Liste schreiben? Darf ein Editor die Liste löschen? Lässt sich ein
Einladungstoken zweimal einlösen? Und darf `anon` die SECURITY-DEFINER-
Funktionen aufrufen?

**Lokal, ohne Supabase** (braucht nur Docker):

```bash
npm run db:test
```

Startet ein frisches Postgres im Container, baut die nötigen Teile der
Supabase-Umgebung nach (`supabase/tests/local_bootstrap.sql` — Rollen
`anon`/`authenticated`, Originaldefinitionen von `auth.uid()` und `auth.jwt()`),
spielt die Migrationen ein und fährt den Test. Exit-Code 0 = alles grün, 1 =
eine Regel ist verletzt.

**Gegen das echte Projekt**: `supabase/tests/rls_test.sql` komplett in den
SQL-Editor einfügen. Der Test läuft in einer Transaktion und endet mit
`ROLLBACK` — er hinterlässt weder Testdaten noch Testnutzer.

Der Test hat Zähne. Mit absichtlich aufgeweichten Policies (`using (true)` auf
`tasks_select`, Editoren dürfen löschen, die Rekursionsfalle auf
`list_members` wieder eingebaut) schlägt er jeweils fehl und benennt die
verletzte Regel. Und mit zu weit entzogenen Rechten (`revoke execute … from
authenticated`) ebenfalls — der Fehler, der die App still zerlegen würde.

Akt 8 stammt aus einem echten Befund des Supabase-Security-Advisors: das
`revoke execute … from anon` in `0002_rls.sql` lief ins Leere, weil Postgres
`EXECUTE` automatisch an `PUBLIC` vergibt und `anon` daraus erbt. Behoben in
`0004_function_privileges.sql`, nachgestellt in Akt 8 — ein Befund, den kein
Test nachstellt, kommt zurück.

### Google-Anmeldung einrichten

Der Code steht auf allen Plattformen. Es fehlen nur die Zugangsdaten, und die
müssen aus zwei Konsolen kommen.

**1. Google Cloud Console** → APIs & Services → Credentials → OAuth client ID
(Typ „Web application"). Dort eintragen:

| Feld | Wert |
|---|---|
| Authorized JavaScript origins | `https://<projekt>.supabase.co` |
| Authorized redirect URIs | `https://<projekt>.supabase.co/auth/v1/callback` |

Wichtig: Das ist die Adresse **von Supabase**, nicht die der App. Google spricht
nur mit Supabase; erst Supabase leitet zur App weiter. Der häufigste
Einrichtungsfehler ist, hier `localhost:1420` einzutragen.

Beim ersten Mal verlangt Google außerdem einen OAuth-Consent-Screen. Solange er
auf „Testing" steht, dürfen sich nur eingetragene Testnutzer anmelden.

**2. Supabase** → Authentication → Providers → Google: aktivieren, Client ID und
Client Secret aus Schritt 1 einfügen.

**3. Supabase** → Authentication → URL Configuration → Redirect URLs. Hier
müssen alle Adressen stehen, auf die zurückgesprungen werden darf:

```
http://localhost:1420          Entwicklung im Browser
planner://auth-callback        Desktop und Android
https://deine-domain.de        produktive Web-Version
```

Fehlt ein Eintrag, bricht Supabase mit „requested path is invalid" ab. Die App
übersetzt das in einen Satz, der auf diese Stelle zeigt.

#### Warum in der App der Systembrowser aufgeht

Google lehnt Anmeldungen in eingebetteten WebViews ab — und das zu Recht: eine
App, die das Passwortfeld selbst rendert, könnte mitlesen. Deshalb macht die
Desktop- und Android-Version es so:

1. Sie holt die Anmelde-URL von Supabase, folgt ihr aber nicht selbst.
2. Sie öffnet sie im Systembrowser, wo die echte Adresszeile sichtbar ist.
3. Supabase schickt den Browser danach auf `planner://auth-callback?code=…`.
4. Das Betriebssystem reicht die URL an die laufende App weiter, die den Code
   gegen eine Sitzung tauscht.

Der PKCE-Verifier bleibt dabei im localStorage derselben WebView und verlässt
das Gerät nie — deshalb ist der Code allein wertlos, falls ihn jemand abfängt.

Unter Windows und Linux trägt normalerweise der Installer das Schema
`planner://` ins System ein. Im Entwicklungsmodus gibt es keinen Installer,
deshalb registriert die App es beim Start selbst (`register_all()` in
`src-tauri/src/lib.rs`). Ohne das führt der Rücksprung ins Leere, und zwar
ohne Fehlermeldung.

## Architektur

```
src/
├── data/           Datenschicht - der wichtigste Teil
│   ├── types.ts            Domänentypen (camelCase, entkoppelt vom Schema)
│   ├── repository.ts       Interface: die EINZIGE Tür zu den Daten
│   ├── localRepository.ts  Implementierung: IndexedDB, ein Gerät
│   ├── supabaseRepository.ts  Implementierung: Postgres + RLS + Realtime
│   ├── hooks.ts            TanStack Query, überall optimistische Updates
│   ├── recurrence.ts       Wiederholungsregeln
│   └── tree.ts             flache Liste -> Unterpunkt-Baum
├── features/       tasks, lists, search, share, settings
├── pages/          Übersicht, Agenda (Heute/Demnächst), Liste, Einladung
├── lib/            parseQuickAdd, ordering (Fractional Index), date, platform
│   ├── desktop.ts          Panel: anheften, Position, Weg ins Hauptfenster
│   └── widget.ts           der Stand für Tray-Symbol und Homescreen-Widget
└── ui/             Dialog, Toaster

src-tauri/
├── src/lib.rs      Tray, Panel, globales Kürzel, Deep-Link, Updater
├── capabilities/   Berechtigungen, je Plattform getrennt
└── plugins/planner-widget/   Android-Widget: Rust-Brücke + Kotlin
```

Vier Entscheidungen, die den Rest erklären:

**Alles läuft über `Repository`.** Keine Komponente kennt Supabase. Der
Sync-Ansatz wird sich noch ändern — von "online mit Cache" über PowerSync
(lokales SQLite, echtes Offline-Schreiben) bis vielleicht zum eigenen Server.
Jede dieser Stufen ist eine weitere Datei neben `supabaseRepository.ts` und ein
Zweig in `RepositoryProvider.tsx`. Nicht ein Umbau der halben App.

**Berechtigungen stehen in der Datenbank, nicht im Client.**
`supabase/migrations/0002_rls.sql` ist die einzige Wahrheit darüber, wer was
sehen und ändern darf. Ein `if (role !== 'owner')` im Frontend wäre Kosmetik —
mit dem anon-Key kann jeder die REST-API direkt ansprechen.

**Sortierung per Fractional Index.** `position` ist ein String, kein Integer.
Verschieben schreibt genau eine Zeile statt aller Geschwister — der Unterschied
zwischen "funktioniert" und "zwei Leute überschreiben sich gegenseitig".

**Löschen ist Soft-Delete.** Das ist nicht nur Sync-Hygiene, sondern auch die
Grundlage für "Rückgängig": zurückholen heißt `deleted_at` leeren.

## Desktop

Braucht Rust (<https://rustup.rs>), unter Windows zusätzlich die
Visual-Studio-Build-Tools, unter macOS die Xcode Command Line Tools.

```bash
npm run desktop:dev     # Entwicklung mit Hot Reload
npm run desktop:build   # Installer in src-tauri/target/release/bundle/
```

### Das Menüleisten-Panel

Ein Klick auf das Symbol in der Menüleiste (macOS) bzw. im Infobereich
(Windows) klappt ein Panel auf: was heute fällig ist, ein Feld zum schnellen
Notieren, und die Listen als Kacheln mit der Zahl offener Aufgaben.
`Strg+Umschalt+Leertaste` öffnet es von überall.

Das Panel ist ein eigenes Fenster (`panel`) auf derselben React-App, Route
`#/panel`. Es bekommt bewusst nicht die Shell — keine Seitenleiste, kein
Kopfbalken.

**Bearbeiten geht dort auch.** Ein Tipp auf eine Zeile klappt sie auf: Titel,
Fälligkeit, Priorität, Löschen. Eine Listenkachel führt eine Ebene tiefer in
die Liste, der Pfeil wieder zurück. Das ist kein Widerspruch zum Grundsatz
„ein Panel, aus dem man herausnavigiert, ist ein Fenster mit falschem Rahmen"
— hier navigiert man nicht heraus, sondern innerhalb.

Was darüber hinausgeht, führt weiter über einen Knopf ins Hauptfenster:
Listen anlegen und umsortieren, Unterpunkte umhängen, Notizen, Wiederholung,
Teilen. Ein 380 Pixel breites Popover ist dafür der falsche Ort.

Rechtsklick aufs Symbol öffnet das Menü mit „Panel anzeigen", „Hauptfenster
öffnen" und „Beenden" — der erste Eintrag ist für Linux, wo Tray-Symbole je
nach Desktop-Umgebung gar kein Linksklick-Ereignis liefern. Das Hauptfenster
zu schließen beendet die App nicht — sie lebt in der Menüleiste weiter.

#### Angeheftet wird das Panel zum Widget

Die Stecknadel oben rechts schaltet um. Angeheftet bleibt dasselbe Fenster
stehen, statt beim Klick daneben zu verschwinden, merkt sich seine Position und
ist nach einem Neustart wieder da.

Über das Verstecken bei Fokusverlust entscheidet Rust in `on_window_event` —
deshalb liegt der laufende Zustand dort und nicht im Frontend. Eine Rückfrage
in die WebView wäre ein Wettlauf: das Panel wäre weg, bevor die Antwort da ist.
Was der Nutzer eingestellt hat, merkt sich umgekehrt das Frontend
(`localStorage`) und meldet es beim Start einmal nach unten — Rust hat für so
etwas keinen Ort, der einen Neustart überlebt.

Die gemerkte Position wird beim Wiederherstellen gegen die angeschlossenen
Bildschirme geprüft. Wer das Panel im Büro auf den zweiten Monitor schiebt und
den Rechner zu Hause ohne diesen startet, bekäme sonst ein Fenster bei
x = 2400 — sichtbar nirgends, und weil es kein Taskleistensymbol hat, auch
nicht zurückzuholen.

#### Die Zahl am Symbol

Das Tray-Symbol trägt, wie viel heute noch offen ist: auf macOS als Zahl neben
dem Symbol, überall als Kurzinfo beim Darüberfahren. Gerechnet wird das in
`src/lib/widget.ts` — derselbe Schnappschuss, der auf Android ins
Homescreen-Widget geht. Abgeschickt wird er aus der Shell des Hauptfensters,
nie aus dem Panel: das läuft in einer eigenen WebView mit eigenem Query-Cache,
und zwei Absender für dieselbe Zahl werden früher oder später uneinig.

### Automatische Updates

Die Desktop-App prüft beim Start (und alle sechs Stunden) bei GitHub Releases,
ob es eine neuere Version gibt, und bietet sie als Meldung an. Geladen und
eingespielt wird erst auf Klick, neu gestartet ebenfalls.

Unter **Einstellungen → Programm** stehen die laufende Version und ein Knopf
„Nach Updates suchen". Beide Wege teilen sich Abfrage und Installation; der
Unterschied ist die Antwort, wenn es nichts zu holen gibt. Die automatische
Prüfung schweigt dann — sonst meldete sie sich alle sechs Stunden, um nichts
zu sagen. Die angestoßene antwortet, denn „keine Meldung" ist von „hat nicht
funktioniert" nicht zu unterscheiden.

Die Pakete sind signiert. Der öffentliche Schlüssel steht in
`tauri.conf.json`, der private gehört als GitHub-Secret hinterlegt und **nie
ins Repository** (`.tauri/` ist ignoriert). Deshalb muss der Auslieferungsweg
nicht vertrauenswürdig sein: wer das Release austauscht, hat trotzdem nicht
den Schlüssel.

**Android bekommt keine automatischen Updates.** Ein In-App-Updater ist dort
systemseitig nicht vorgesehen — Aktualisierungen laufen über den Play Store
oder ein manuell installiertes APK. Im Web ist ein Neuladen die
Aktualisierung.

#### Release bauen

`.github/workflows/release.yml` baut auf einen Versions-Tag hin für macOS
(Apple Silicon und Intel), Windows und Linux und legt daraus einen
Release-Entwurf an — inklusive `latest.json`, das der Updater liest.

```bash
npm version 0.2.0 && git push --follow-tags
```

macOS-Apps lassen sich nur auf macOS bauen; der Workflow ist deshalb nicht
Bequemlichkeit, sondern die Voraussetzung dafür, ohne eigenen Mac eine
Mac-App auszuliefern.

Nötige GitHub-Secrets (Settings → Secrets and variables → Actions):

| Secret | Wofür |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Inhalt von `.tauri/planner.key` — ohne das kein gültiges Update |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | leer lassen, wenn der Schlüssel keins hat |
| `VITE_SUPABASE_URL` | sonst laufen die Apps im lokalen Modus |
| `VITE_SUPABASE_ANON_KEY` | dito |
| `VITE_PUBLIC_APP_URL` | Basis für Einladungslinks |

Optional für signierte, notarisierte macOS-Builds: `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID`. Ohne sie entsteht eine lauffähige, aber
unsignierte App — Gatekeeper verlangt dann beim ersten Start Rechtsklick →
Öffnen. Für den Eigengebrauch tragbar, zum Weitergeben nicht.

Der Release bleibt zunächst ein **Entwurf**. Erst wenn alle Plattformen
fertig sind und du ihn veröffentlichst, sieht der Updater ihn — sonst holt
er sich ein halbes Release.

## Android bauen

Voraussetzungen: Android Studio samt SDK und NDK, `JAVA_HOME`, `ANDROID_HOME`
und `NDK_HOME` gesetzt, dazu die Rust-Targets:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi \
                  i686-linux-android x86_64-linux-android

npm run android:init    # einmalig, erzeugt src-tauri/gen/android
npm run android:dev     # auf Gerät oder Emulator
npm run android:build   # APK/AAB
```

### Das Homescreen-Widget

Liegt in `src-tauri/plugins/planner-widget/` — einem eigenen Tauri-Plugin mit
Rust-Brücke und Gradle-Bibliothek, nicht als Änderung am erzeugten
Gradle-Projekt: `tauri android init` kann `gen/android` jederzeit neu
schreiben, ein Plugin überlebt das.

```
plugins/planner-widget/
├── src/lib.rs                 nimmt den Schnappschuss entgegen, reicht ihn durch
├── permissions/default.toml   erlaubt genau einen Befehl: update_snapshot
└── android/src/main/
    ├── PlannerWidgetPlugin.kt   die Tauri-Seite: @Command updateSnapshot
    ├── WidgetStore.kt           SharedPreferences als Ablage zwischen beiden
    ├── PlannerWidgetProvider.kt Kopfzeile, Klickziele, Neuzeichnen
    └── PlannerWidgetService.kt  füllt die Liste (RemoteViewsFactory)
```

Warum es die Brücke braucht: Ein App-Widget wird vom Launcher gezeichnet und
kann die Daten der App nicht lesen — die IndexedDB der WebView schon gar nicht.
Es braucht also eine Ablage, in die die App schreibt, **und** ein Signal an den
`AppWidgetManager`. Ohne das zweite zeigte das Widget den neuen Stand erst beim
nächsten Aktualisierungslauf des Systems.

`updatePeriodMillis` ist bewusst `0`. Ein Wecklauf könnte ohnehin nur denselben
gespeicherten Stand neu zeichnen; neue Daten gäbe es nur, wenn die App liefe.
Aktualisiert wird deshalb, wenn die App etwas ändert, und auf Tippen des
Knopfes — alles andere wäre Batterieverbrauch ohne Ertrag. Ist der Stand älter
als zwölf Stunden, sagt das Widget das in der Kopfzeile, statt „Heute 14:30"
über etwas zu schreiben, das von vorgestern ist.

**RemoteViews statt Jetpack Glance.** Glance ist Compose, und Compose bindet
den Kotlin-Compiler an eine passende Version des Compose-Plugins — in einem
Gradle-Projekt, dessen Kotlin-Version Tauri vorgibt. RemoteViews kostet etwas
mehr XML und hängt dafür an nichts, was beim nächsten Tauri-Update
auseinanderfällt.

**Das Widget schreibt nicht.** Kein Haken, kein Löschen. Das müsste die App
starten, Supabase erreichen und mit Wiederholungsregeln umgehen — im
Launcher-Prozess, ohne Netz-Garantie und ohne Ort für eine Fehlermeldung.
Tippen öffnet die App, dort steht alles.

## Web ausliefern

`npm run build` erzeugt `dist/` — ein statischer Ordner für Cloudflare Pages,
Netlify, Vercel oder jeden Webserver. Die App nutzt Hash-Routing, deshalb
braucht es keine Server-Rewrites.

### Cloudflare Workers

Die Konfiguration steht in `wrangler.jsonc` — rein statische Auslieferung aus
`dist/`, kein Worker-Code.

| Einstellung | Wert |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node-Version | aus `.node-version` (22) |

Aus der Kommandozeile: **`npm run deploy`**.

Nicht `wrangler deploy` verwenden. Das lädt hoch, was gerade in `dist/`
liegt — ohne zu prüfen, womit es gebaut wurde. So ging zweimal eine Version
ohne Login live, ohne dass irgendetwas fehlschlug. `npm run deploy` räumt
`dist/` weg, baut frisch und bricht ab, wenn die Supabase-Konfiguration nicht
im Bundle steht:

```
✗ Das Bundle enthaelt die Supabase-Konfiguration nicht.
  Es wird NICHT hochgeladen.
```

Für einen bewusst loginlosen Deploy: `npm run deploy -- --local`.

#### Die Umgebungsvariablen sind der Knackpunkt

Vite ersetzt `VITE_*` zur **Buildzeit** und backt die Werte ins Bundle. Wo sie
hingehören, hängt deshalb davon ab, wo gebaut wird:

| Deploy-Weg | Wo die Variablen stehen müssen |
|---|---|
| `npx wrangler deploy` (Upload) | lokal in `.env.local`, vor `npm run build` |
| Git-Anbindung (Workers Builds) | in den Build-Einstellungen des Workers |

Was **nicht** funktioniert: Settings → Variables and Secrets. Das sind
Laufzeit-Variablen für Worker-Code. Diese App ist rein statisch und liest zur
Laufzeit gar nichts — die Werte stehen längst im ausgelieferten JavaScript
oder eben nicht.

```
VITE_SUPABASE_URL        https://<projekt>.supabase.co
VITE_SUPABASE_ANON_KEY   <anon-Key>
VITE_PUBLIC_APP_URL      https://<deine-domain>
```

Fehlen sie, schlägt der Build **nicht** fehl. Er erzeugt eine App im lokalen
Modus: kein Login, Daten nur im Browser des jeweiligen Besuchers. Das sieht aus
wie eine funktionierende Seite, ist aber die falsche.

Zwei Wege, das zu erkennen, ohne zu raten:

* Das „lokal"-Abzeichen oben links in der Seitenleiste.
* Die Bundle-Größe. Ist `VITE_SUPABASE_URL` zur Buildzeit leer, faltet Vite
  `supabaseConfigured` zu `false` und wirft `@supabase/supabase-js` komplett
  heraus — rund 408 KB statt 609 KB:

  ```bash
  curl -s https://<domain>/assets/index-*.js | wc -c
  ```

Neue Werte greifen erst nach einem erneuten **Build plus Deploy** — den Worker
neu zu starten ändert nichts, weil die Werte im Bundle stehen.

#### Nach jedem neuen Domainnamen

Jede Adresse, unter der die App erreichbar ist, muss in Supabase unter
Authentication → URL Configuration → Redirect URLs stehen — sonst schlägt die
Google-Anmeldung dort fehl:

```
https://<worker>.workers.dev
https://planner.example.com
```

Und `VITE_PUBLIC_APP_URL` auf die endgültige Adresse setzen: davon hängen die
Einladungslinks ab. Steht dort die alte Adresse, verschickt man Links, die
später ins Leere zeigen.

#### Eigene Domain

Die Zone muss bei Cloudflare liegen. Dann entweder im Dashboard unter
Settings → Domains & Routes eintragen, oder den auskommentierten `routes`-Block
in `wrangler.jsonc` aktivieren.

### Security-Header

`public/_headers` wird von Cloudflare Pages und Netlify gelesen und liefert
CSP, `X-Content-Type-Options`, `Referrer-Policy` und `Permissions-Policy` aus.
Ohne diese Datei ginge die Seite ganz ohne CSP live — die Tauri-Variante bringt
ihre eigene über `tauri.conf.json` mit, im Web gibt es dafür keinen Ort im
Bundle.

Getestet wurde die CSP gegen den echten Build: alle Ansichten, Dialoge, Suche
und die farbigen Kacheln (deren Farben als Inline-Styles kommen, der heikelste
Punkt) laufen ohne Verstoß.

Bei selbst gehostetem Supabase muss der eigene Host in `connect-src` ergänzt
werden — sonst schlagen alle Anfragen fehl, und zwar stumm in der Konsole.

Der Bundle liegt bei rund 610 KB roh, 177 KB gzip. Gut die Hälfte davon ist
`@supabase/supabase-js`. Baut man ohne `.env.local`, sind es nur 408 KB — Vite
faltet dann `supabaseConfigured` zu `false` und wirft die ganze Bibliothek
heraus. Wer Zahlen vergleicht, sollte also wissen, welche der beiden Builds
gemeint ist.

## Nächste Schritte

1. **Login und Security abrunden** — Anmeldung, Nutzertrennung und RLS stehen
   und sind durch `npm run db:test` abgesichert. Offen sind
   Passwort-zurücksetzen, E-Mail-Bestätigung, Rate-Limiting und der
   Deep-Link-Rücksprung für OAuth in Tauri.
2. **Android bauen** — Das Widget ist geschrieben
   (`src-tauri/plugins/planner-widget/`), das Gradle-Projekt fehlt noch:
   `npm run android:init` ist der Einstieg. Ablauf und die drei bekannten
   Stolperstellen stehen in [STAND.md](STAND.md).
3. **Echtes Offline-Schreiben** — [PowerSync](https://powersync.com) als
   `PowerSyncRepository`. Aktuell überlebt der Query-Cache zwar den Neustart,
   Schreiben braucht aber Netz.
4. **Drag & Drop** — `Alt+↑/↓` funktioniert; die Maus-Geste fehlt noch
   (`keyForIndex` in `lib/ordering.ts` ist die Datenseite dafür).
5. **Einladungs-E-Mails** — aktuell muss der Link von Hand verschickt werden.
6. **Google Tasks / Calendar** — Vorsicht: die Tasks-API kann nur eine Ebene
   Unterpunkte und keine Uhrzeiten. Für vollständige Sicherungen bleibt der
   JSON-Export der Weg.

## Fallstricke

- **Selbst gehostetes Supabase**: Die CSP in `src-tauri/tauri.conf.json`
  erlaubt nur `*.supabase.co`. Eigener Host muss dort in `connect-src`
  ergänzt werden, sonst schlagen in der Desktop-App alle Anfragen fehl —
  ohne sichtbare Fehlermeldung.
- **Android im Dev-Modus** lädt über `http://<lan-ip>:1420`. Das ist kein
  Secure Context: `crypto.randomUUID` und die Zwischenablage-API fehlen dort.
  Beides ist in `lib/id.ts` und im Teilen-Dialog abgefangen.
- **`erasableSyntaxOnly`** ist in `tsconfig.app.json` aktiv: keine Enums, keine
  Parameter-Properties im Konstruktor.
