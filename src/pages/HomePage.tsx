import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, Check, Inbox, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAllTasks, useLists, useUpdateTask } from '@/data/hooks'
import type { List, Task } from '@/data/types'
import { addDaysIso, formatDueDate, isOverdue, toIsoDate, todayIso } from '@/lib/date'
import { sortByPosition } from '@/lib/ordering'
import { listColor } from '@/features/lists/listColors'
import { NewListDialog } from '@/features/lists/NewListDialog'

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

  const sortedLists = sortByPosition(lists)
  const listById = new Map(lists.map((l) => [l.id, l]))

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="mb-7">
        <p className="text-sm text-muted">{greeting()}</p>
        <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">
          {new Intl.DateTimeFormat('de-DE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(new Date())}
        </h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <TodayTile tasks={dueToday} listById={listById} />
        <UpcomingTile count={upcomingCount} />
      </div>

      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-muted">
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

const MAX_TODAY_PREVIEW = 5

function TodayTile({
  tasks,
  listById,
}: {
  tasks: Task[]
  listById: Map<string, List>
}) {
  const overdue = tasks.filter((t) => isOverdue(t.dueAt)).length
  const preview = tasks.slice(0, MAX_TODAY_PREVIEW)

  return (
    <section
      className="tile"
      style={{ '--tile-color': 'oklch(0.37 0.09 152)' } as CSSProperties}
    >
      <div className="flex items-baseline justify-between gap-4">
        <Link to="/heute" className="flex items-center gap-2 text-lg font-semibold hover:underline">
          <CalendarCheck size={18} />
          Heute fällig
        </Link>
        <span className="text-sm opacity-80 tabular-nums">
          {tasks.length === 0
            ? 'nichts offen'
            : `${tasks.length} ${tasks.length === 1 ? 'Aufgabe' : 'Aufgaben'}`}
          {overdue > 0 && ` · ${overdue} überfällig`}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-3 text-sm opacity-75">
          Nichts fällig. Auch das ist ein Ergebnis.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {preview.map((task) => (
            <TodayItem key={task.id} task={task} list={listById.get(task.listId)} />
          ))}
        </ul>
      )}

      {tasks.length > MAX_TODAY_PREVIEW && (
        <Link to="/heute" className="mt-2 text-xs underline opacity-80 hover:opacity-100">
          … und {tasks.length - MAX_TODAY_PREVIEW} weitere anzeigen
        </Link>
      )}
    </section>
  )
}

function UpcomingTile({ count }: { count: number }) {
  return (
    <Link
      to="/demnaechst"
      className="tile justify-between"
      style={{ '--tile-color': '#2D6396' } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Inbox size={18} />
          Demnächst
        </h2>
        <ArrowRight size={17} className="mt-1 shrink-0 opacity-50" />
      </div>

      <div className="mt-4">
        <span className="text-3xl font-semibold tabular-nums">{count}</span>
        <span className="ml-1.5 text-sm opacity-80">
          {count === 1 ? 'Aufgabe' : 'Aufgaben'}
        </span>
        <p className="mt-1 text-xs opacity-70">in den nächsten 7 Tagen</p>
      </div>
    </Link>
  )
}

function TodayItem({ task, list }: { task: Task; list: List | undefined }) {
  // Der Hook braucht die listId - deshalb ist jede Zeile eine eigene
  // Komponente statt eines Fragments in der Schleife.
  const updateTask = useUpdateTask(task.listId)

  return (
    <li className="group -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10">
      <button
        onClick={() => updateTask.mutate({ id: task.id, patch: { done: true } })}
        className="flex size-[18px] shrink-0 items-center justify-center rounded-md border-2 border-white/65 transition-colors hover:border-white hover:bg-white/25"
        aria-label={`„${task.title}“ als erledigt markieren`}
      >
        <Check
          size={12}
          strokeWidth={3}
          className="opacity-0 transition-opacity group-hover:opacity-70"
        />
      </button>

      <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>

      {list && <span className="shrink-0 text-xs opacity-65">{list.name}</span>}

      {task.dueAt && isOverdue(task.dueAt) && (
        <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-medium">
          {formatDueDate(task.dueAt, task.allDay)}
        </span>
      )}
    </li>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Noch wach?'
  if (hour < 11) return 'Guten Morgen'
  if (hour < 18) return 'Guten Tag'
  return 'Guten Abend'
}
