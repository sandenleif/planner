# Planner

Eine To-do-App mit geteilten Listen — im Browser, auf Windows, macOS und Android.

Eine Codebase (React + TypeScript), drei Auslieferungswege: der Vite-Build ist
die Web-App, Tauri v2 verpackt denselben Build als Desktop-Programm und als
Android-APK.

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
Live-Sync über Supabase Realtime.

**Rückgängig statt Rückfrage.** Gelöschte Aufgaben lassen sich aus der
Meldung heraus zurückholen, samt Unterpunkten.

**Details je Aufgabe**: Notizen, Priorität, Wiederholung.

**Desktop-Integration** — Tray-Symbol, Schließen versteckt statt beendet,
`Strg+Umschalt+Leertaste` holt das Fenster von überall.

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

### Google-Anmeldung

Optional, im Dashboard unter Authentication → Providers → Google. Im Browser
funktioniert der Rücksprung sofort; in der Tauri-App braucht er einen
Deep-Link-Handler (`tauri-plugin-deep-link`) — bis dahin ist dort E-Mail plus
Passwort der verlässliche Weg.

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
└── ui/             Dialog, Toaster
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

## Desktop bauen

Braucht Rust (<https://rustup.rs>), unter Windows zusätzlich die
Visual-Studio-Build-Tools, unter macOS die Xcode Command Line Tools.

```bash
npm run desktop:dev     # Entwicklung mit Hot Reload
npm run desktop:build   # Installer in src-tauri/target/release/bundle/
```

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

## Web ausliefern

`npm run build` erzeugt `dist/` — ein statischer Ordner für Netlify, Vercel,
Cloudflare Pages oder jeden Webserver. Die App nutzt Hash-Routing, deshalb
braucht es keine Server-Rewrites.

## Nächste Schritte

1. **Login und Security abrunden** — Anmeldung, Nutzertrennung und RLS stehen
   und sind durch `npm run db:test` abgesichert. Offen sind
   Passwort-zurücksetzen, E-Mail-Bestätigung, Rate-Limiting und der
   Deep-Link-Rücksprung für OAuth in Tauri.
2. **Android-Widget** — Jetpack Glance im generierten Gradle-Projekt.
   `Repository.getDueTasks()` ist genau die Abfrage, die das Widget braucht.
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
