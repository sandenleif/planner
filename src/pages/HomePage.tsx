import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAllTasks, useLists } from '@/data/hooks'
import type { List } from '@/data/types'
import { addDaysIso, isOverdue, toIsoDate, todayIso } from '@/lib/date'
import { sortByPosition } from '@/lib/ordering'
import { listColor } from '@/features/lists/listColors'
import { NewListDialog } from '@/features/lists/NewListDialog'
import { FlatTaskRow } from '@/features/tasks/FlatTaskRow'

/**
 * Drei, nicht fünf und schon gar nicht alle.
 *
 * Die Übersicht soll die Frage „was jetzt" in einem Blick beantworten. Eine
 * Vorschau, die scrollt, ist keine Vorschau mehr, sondern eine zweite
 * Heute-Ansicht — und dann bräuchte es die erste nicht.
 */
const MAX_TODAY_PREVIEW = 3

/**
 * Startseite: Kachelübersicht.
 *
 * Aufgebaut auf EINER Abfrage über alle Aufgaben statt einer pro Liste.
 * Bei den Datenmengen einer To-do-App ist das schneller (ein Roundtrip statt
 * n) und macht die Zählungen konsistent - sonst zeigt Kachel A schon den
 * neuen Stand, während Kachel B noch nachlädt.
 */
export function HomePage() {
  const { data: lists = [], isLoading } = useLists()
  const { data: tasks = [] } = useAllTasks()
  const [creating, setCreating] = useState(false)

  const today = todayIso()

  const stats = useMemo(() => {
    const map = new Map<string, { open: number; done: number }>()
    for (const list of lists) map.set(list.id, { open: 0, done: 0 })

    for (const task of tasks) {
      const entry = map.get(task.listId)
      if (!entry) continue
      if (task.done) entry.done++
      else entry.open++
    }
    return map
  }, [lists, tasks])

  const dueToday = useMemo(() => {
    const limit = new Date(`${today}T23:59:59.999`).getTime()
    return tasks
      .filter((t) => !t.done && t.dueAt !== null && new Date(t.dueAt).getTime() <= limit)
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
  }, [tasks, today])

  const upcomingCount = useMemo(() => {
    const weekEnd = addDaysIso(today, 6)
    return tasks.filter(
      (t) =>
        !t.done &&
        t.dueAt !== null &&
        toIsoDate(new Date(t.dueAt)) > today &&
        toIsoDate(new Date(t.dueAt)) <= weekEnd,
    ).length
  }, [tasks, today])

  // Steht schon in dueToday drin - überfällige Aufgaben sind ja auch heute
  // fällig. Herausgezählt wird es, weil „7 fällig" und „2 davon überfällig"
  // zwei verschiedene Dringlichkeiten sind.
  const overdueCount = dueToday.filter((t) => isOverdue(t.dueAt)).length

  const sortedLists = sortByPosition(lists)
  const listById = new Map(lists.map((l) => [l.id, l]))

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      {/*
        Die Zahl führt, nicht die Begrüßung.

        Vorher stand „Guten Morgen" klein über dem Datum in 30 Pixeln — und
        die Zahl, wegen der man die App überhaupt öffnet, weiter unten in 12.
        Die Hierarchie stand auf dem Kopf: Das Datum weiß man, die Begrüßung
        ändert nichts, die Zahl beantwortet die Frage.

        Gruß und Datum bleiben, aber als Zeile darüber. Die Wärme kostet
        nichts, solange sie nicht die Schlagzeile beansprucht.
      */}
      <header className="mb-7">
        <p className="text-label font-bold uppercase tracking-[0.1em] text-muted">
          {greeting()} ·{' '}
          {new Intl.DateTimeFormat('de-DE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(new Date())}
        </p>

        {dueToday.length > 0 ? (
          <>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-hero font-bold leading-none tracking-tight tabular-nums">
                {dueToday.length}
              </span>
              <span className="text-base leading-tight">
                {dueToday.length === 1 ? 'Aufgabe' : 'Aufgaben'}
                <br />
                heute fällig
              </span>
            </div>

            {overdueCount > 0 && (
              <p className="mt-2.5 text-sm font-semibold text-red-600 dark:text-red-400">
                {overdueCount === 1
                  ? '1 davon ist überfällig'
                  : `${overdueCount} davon sind überfällig`}
              </p>
            )}
          </>
        ) : (
          // „0 Aufgaben heute fällig" ist richtig und liest sich wie ein
          // Fehler. Ein Satz sagt dasselbe und klingt nach Feierabend.
          <p className="mt-2 text-screen font-bold tracking-tight">
            Heute ist nichts fällig.
          </p>
        )}
      </header>

      {/*
        Ein Blick, keine Liste. Drei Zeilen beantworten „was jetzt", alles
        Weitere steht hinter „Heute".

        Vorher standen hier zwei große farbige Kacheln. Sie sahen wichtig aus
        und waren es nicht: Die Farbe gehört den Listen, und wenn „Heute" und
        „Demnächst" sie sich ausleihen, bedeutet sie unten in den Zeilen nichts
        mehr. Es sind jetzt dieselben Zeilen wie überall — man lernt sie einmal.
      */}
      {dueToday.length > 0 && (
        <section className="mb-2">
          <h2 className="px-1 pb-1 text-label font-bold uppercase tracking-[0.1em] text-muted">
            Als Nächstes
          </h2>
          <div className="-mx-3.5 divide-y divide-ink/8">
            {dueToday.slice(0, MAX_TODAY_PREVIEW).map((task) => (
              <FlatTaskRow key={task.id} task={task} list={listById.get(task.listId)} />
            ))}
          </div>
          {dueToday.length > MAX_TODAY_PREVIEW && (
            <Link
              to="/heute"
              className="mt-2 inline-block px-1 text-meta text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              … und {dueToday.length - MAX_TODAY_PREVIEW} weitere
            </Link>
          )}
        </section>
      )}

      {/* „Demnächst" als Zeile statt als Kachel: Es ist ein Hinweis auf etwas,
          das noch nicht dran ist — und soll sich nicht so anfühlen, als wäre
          es dran. */}
      {upcomingCount > 0 && (
        <Link
          to="/demnaechst"
          className="mt-4 flex items-center gap-2 px-1 text-sm text-muted transition-colors hover:text-ink"
        >
          <span>
            <span className="font-semibold tabular-nums text-ink">{upcomingCount}</span>{' '}
            {upcomingCount === 1 ? 'Aufgabe' : 'Aufgaben'} in den nächsten 7 Tagen
          </span>
          <ArrowRight size={15} className="shrink-0" />
        </Link>
      )}

      <h2 className="mb-3 mt-8 px-1 text-label font-bold uppercase tracking-[0.1em] text-muted">
        Listen
      </h2>

      {isLoading && <p className="text-sm text-muted">Lädt …</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedLists.map((list) => (
          <ListTile
            key={list.id}
            list={list}
            stats={stats.get(list.id) ?? { open: 0, done: 0 }}
          />
        ))}

        <button
          onClick={() => setCreating(true)}
          className={clsx(
            'flex min-h-36 flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)]',
            'border-2 border-dashed border-subtle text-muted transition-colors',
            'hover:border-accent-500 hover:bg-panel hover:text-accent-700',
          )}
        >
          <Plus size={22} />
          <span className="text-sm font-medium">Neue Liste</span>
        </button>
      </div>

      <NewListDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function ListTile({
  list,
  stats,
}: {
  list: List
  stats: { open: number; done: number }
}) {
  const total = stats.open + stats.done
  const percent = total === 0 ? 0 : Math.round((stats.done / total) * 100)

  return (
    <Link
      to={`/list/${list.id}`}
      className="tile min-h-36 justify-between"
      style={{ '--tile-color': listColor(list.color) } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold leading-snug">{list.name}</h3>
        <ArrowRight size={17} className="mt-1 shrink-0 opacity-50" />
      </div>

      <div className="mt-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tabular-nums">{stats.open}</span>
          <span className="text-sm opacity-80">offen</span>
        </div>

        {total > 0 && (
          <>
            {/* Fortschritt als reine Fläche statt als Prozentzahl: man will
                hier auf einen Blick sehen, wie weit es ist - nicht rechnen. */}
            <div
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/25"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${stats.done} von ${total} erledigt`}
            >
              <div
                className="h-full rounded-full bg-white transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs opacity-75">
              {stats.done} von {total} erledigt
            </p>
          </>
        )}
      </div>
    </Link>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Noch wach?'
  if (hour < 11) return 'Guten Morgen'
  if (hour < 18) return 'Guten Tag'
  return 'Guten Abend'
}
