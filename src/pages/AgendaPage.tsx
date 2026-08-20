import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { CalendarCheck, Inbox } from 'lucide-react'
import { useAllTasks, useLists } from '@/data/hooks'
import type { Task } from '@/data/types'
import { addDaysIso, isOverdue, toIsoDate, todayIso } from '@/lib/date'
import { FlatTaskRow } from '@/features/tasks/FlatTaskRow'

export type AgendaMode = 'today' | 'upcoming'

const HERO_COLOR: Record<AgendaMode, string> = {
  today: 'oklch(0.37 0.09 152)',
  upcoming: '#2D6396',
}

const TITLE: Record<AgendaMode, string> = {
  today: 'Heute',
  upcoming: 'Demnächst',
}

const UPCOMING_DAYS = 7

/**
 * Listenübergreifende Agenda - "Heute" und "Demnächst" in einer Komponente.
 *
 * Beide unterscheiden sich nur im Zeitfenster und in der Gruppierung. Zwei
 * getrennte Seiten wären zwei Stellen, an denen dieselbe Zeilenlogik driftet.
 */
export function AgendaPage({ mode }: { mode: AgendaMode }) {
  const { data: tasks = [], isLoading } = useAllTasks()
  const { data: lists = [] } = useLists()

  const today = todayIso()
  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists])

  const { overdue, groups, total } = useMemo(() => {
    const horizon = mode === 'today' ? today : addDaysIso(today, UPCOMING_DAYS - 1)
    const limit = new Date(`${horizon}T23:59:59.999`).getTime()

    const open = tasks
      .filter((t) => !t.done && t.dueAt !== null)
      .filter((t) => new Date(t.dueAt!).getTime() <= limit)
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))

    const overdueTasks = open.filter((t) => isOverdue(t.dueAt))
    const rest = open.filter((t) => !isOverdue(t.dueAt))

    // Nach Kalendertag gruppieren. In der Heute-Ansicht gibt es nur eine
    // Gruppe, in "Demnächst" eine pro Tag - deshalb dieselbe Datenstruktur.
    const byDay = new Map<string, Task[]>()
    for (const task of rest) {
      const day = toIsoDate(new Date(task.dueAt!))
      const bucket = byDay.get(day)
      if (bucket) bucket.push(task)
      else byDay.set(day, [task])
    }

    return {
      overdue: overdueTasks,
      groups: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)),
      total: open.length,
    }
  }, [tasks, mode, today])

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      <header
        className="tile mb-5"
        style={{ '--tile-color': HERO_COLOR[mode] } as CSSProperties}
      >
        <div className="flex items-center gap-2.5">
          {mode === 'today' ? <CalendarCheck size={20} /> : <Inbox size={20} />}
          <h1 className="text-2xl font-semibold tracking-tight">{TITLE[mode]}</h1>
        </div>
        <p className="mt-1 text-sm opacity-80">
          {mode === 'today'
            ? new Intl.DateTimeFormat('de-DE', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              }).format(new Date())
            : `Die nächsten ${UPCOMING_DAYS} Tage`}
          {total > 0 && ` · ${total} ${total === 1 ? 'Aufgabe' : 'Aufgaben'}`}
        </p>
      </header>

      {isLoading && <p className="text-sm text-muted">Lädt …</p>}

      {!isLoading && total === 0 && (
        <div className="rounded-[var(--radius-card)] border-2 border-dashed border-subtle px-4 py-14 text-center">
          <p className="text-sm text-muted">
            {mode === 'today'
              ? 'Nichts fällig. Auch das ist ein Ergebnis.'
              : 'Die nächste Woche ist frei.'}
          </p>
        </div>
      )}

      {overdue.length > 0 && (
        <Section title="Überfällig" tone="danger">
          {overdue.map((task) => (
            <FlatTaskRow key={task.id} task={task} list={listById.get(task.listId)} />
          ))}
        </Section>
      )}

      {groups.map(([day, dayTasks]) => (
        <Section key={day} title={dayLabel(day, today)}>
          {dayTasks.map((task) => (
            <FlatTaskRow
              key={task.id}
              task={task}
              list={listById.get(task.listId)}
              // In "Demnächst" steht das Datum schon in der Überschrift.
              showDate={mode === 'today' || !task.allDay}
            />
          ))}
        </Section>
      ))}
    </div>
  )
}

function Section({
  title,
  tone,
  children,
}: {
  title: string
  tone?: 'danger'
  children: ReactNode
}) {
  return (
    <section className="mb-5">
      <h2
        className={
          'mb-2 px-1 text-xs font-semibold uppercase tracking-wider ' +
          (tone === 'danger' ? 'text-red-600' : 'text-muted')
        }
      >
        {title}
      </h2>
      <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
        {children}
      </div>
    </section>
  )
}

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Heute'
  if (day === addDaysIso(today, 1)) return 'Morgen'

  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${day}T12:00:00`))
}
