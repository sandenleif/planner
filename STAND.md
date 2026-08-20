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
| Android | noch nichts gemacht |

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

Für künftige Workflow-Änderungen braucht ein Token die Berechtigung
**Workflows: Read and write** — das normale Git-Login hat sie nicht, deshalb
mussten Workflow-Dateien bisher von Hand eingespielt werden.

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
* **Android** — noch gar nichts. `npm run android:init` ist der Einstieg.
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
