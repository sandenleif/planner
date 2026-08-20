#!/usr/bin/env node
/**
 * Fährt die Migrationen und den RLS-Test gegen ein frisches Postgres im
 * Container — ohne Supabase, ohne Netz, ohne Kosten.
 *
 * Warum lokal und nicht einfach im Supabase-SQL-Editor? Weil der Test dann
 * bei jeder Schemaänderung mitlaufen kann, statt nur dann, wenn jemand daran
 * denkt. Die Supabase-Umgebung wird dafür in local_bootstrap.sql minimal
 * nachgebaut: die Rollen anon/authenticated und die Originaldefinitionen von
 * auth.uid() und auth.jwt(). Mehr braucht es nicht, damit die Policies exakt
 * so ausgewertet werden wie in der Cloud.
 *
 *   npm run db:test           normal
 *   npm run db:test -- --keep Container am Leben lassen (zum Nachschauen)
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTAINER = 'planner-rls-test'
const DB = 'planner_test'
const IMAGE = 'postgres:16-alpine'

const keep = process.argv.includes('--keep')

const SQL_FILES = [
  ['Supabase-Umgebung nachbauen', 'supabase/tests/local_bootstrap.sql'],
  ['Schema', 'supabase/migrations/0001_schema.sql'],
  ['Row Level Security', 'supabase/migrations/0002_rls.sql'],
  ['Realtime', 'supabase/migrations/0003_realtime.sql'],
]

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', ...options })
}

/** Schickt eine SQL-Datei über stdin an psql im Container. */
function psqlFile(relativePath) {
  const sql = readFileSync(join(ROOT, relativePath), 'utf8')
  return spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, encoding: 'utf8' },
  )
}

/** Synchrones Warten - der Ablauf hier ist ohnehin strikt sequenziell. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Entfernt einen eventuell vorhandenen Container - und wartet, bis er
 * wirklich weg ist.
 *
 * `docker rm -f` kehrt zurueck, bevor der Name freigegeben ist. Startet man
 * sofort danach neu, scheitert der Lauf mit einem Namenskonflikt - und der
 * Fehler sieht aus wie ein kaputtes Schema, obwohl es nur die Aufraeumung war.
 */
function cleanup() {
  try {
    docker(['rm', '-f', CONTAINER], { stdio: 'ignore' })
  } catch {
    // Container gab es nicht - kein Problem.
  }

  for (let i = 0; i < 40; i++) {
    const existing = docker([
      'ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.Names}}',
    ]).trim()
    if (existing === '') return
    sleep(250)
  }

  throw new Error(`Container "${CONTAINER}" liess sich nicht entfernen.`)
}

try {
  docker(['info'], { stdio: 'ignore' })
} catch {
  console.error('Docker läuft nicht. Docker Desktop starten und erneut versuchen.')
  process.exit(2)
}

cleanup()

console.log(`Starte ${IMAGE} …`)
docker(
  ['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=test', '-e', `POSTGRES_DB=${DB}`, IMAGE],
  { stdio: 'ignore' },
)

// Der Container ist sofort da, Postgres darin noch nicht.
let ready = false
for (let i = 0; i < 60; i++) {
  const check = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', DB], {
    stdio: 'ignore',
  })
  if (check.status === 0) {
    ready = true
    break
  }
  sleep(500)
}

if (!ready) {
  console.error('Postgres im Container wurde nicht bereit.')
  cleanup()
  process.exit(2)
}

let failed = false

for (const [label, file] of SQL_FILES) {
  const result = psqlFile(file)
  if (result.status !== 0) {
    console.error(`\n✗ ${label} (${file})`)
    console.error(result.stderr || result.stdout)
    failed = true
    break
  }
  console.log(`✓ ${label}`)
}

if (!failed) {
  console.log('\n--- RLS-Test ---')
  const result = psqlFile('supabase/tests/rls_test.sql')
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  // psql schreibt RAISE NOTICE nach stderr; beides zusammen ist die Ausgabe.
  for (const line of output.split('\n')) {
    if (/bestanden|===|FEHLGESCHLAGEN|ERROR|BESTANDEN/.test(line)) {
      console.log(line.replace(/^NOTICE:\s{2}/, ''))
    }
  }

  const passed = (output.match(/bestanden :/g) ?? []).length
  if (result.status !== 0 || /FEHLGESCHLAGEN|ERROR:/.test(output)) {
    console.error(`\n✗ RLS-Test fehlgeschlagen (${passed} Prüfungen kamen durch)`)
    failed = true
  } else {
    console.log(`\n✓ ${passed} Prüfungen bestanden`)
  }
}

if (keep) {
  console.log(`\nContainer "${CONTAINER}" läuft weiter.`)
  console.log(`  docker exec -it ${CONTAINER} psql -U postgres -d ${DB}`)
  console.log(`  docker rm -f ${CONTAINER}`)
} else {
  cleanup()
}

process.exit(failed ? 1 : 0)
