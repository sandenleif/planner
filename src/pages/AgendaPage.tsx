import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useAllTasks, useLists } from '@/data/hooks'
import type { Task } from '@/data/types'
import { addDaysIso, isOverdue, toIsoDate, todayIso } from '@/lib/date'
import { FlatTaskRow } from '@/features/tasks/FlatTaskRow'

export type AgendaMode = 'today' | 'upcoming'

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
      {/*
        Nur Titel und eine Zeile darunter — vorher stand hier eine farbige
        Kachel mit Symbol. Die Farbe gehört jetzt den Listen: Wenn „Heute"
        selbst eine Farbe trägt, konkurriert sie mit den sechs Punkten in den
        Zeilen darunter, und keiner davon bedeutet mehr etwas. Das Symbol
        steht ohnehin unten am aktiven Reiter.
      */}
      <header className="mb-1">
        <h1 className="text-screen font-bold tracking-tight">{TITLE[mode]}</h1>
        <p className="mt-1 text-meta text-muted">
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
    <section className="mb-4">
      <h2
        className={
          'px-1 pb-1 pt-5 text-label font-bold uppercase tracking-[0.1em] ' +
          // Die einzige rote Überschrift auf dem Bildschirm. Wäre sie es
          // nicht, hörte Rot auf zu warnen.
          (tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-muted')
        }
      >
        {title}
      </h2>
      {/* Ohne Karte: Die Zeilen liegen auf dem Grund der Seite. Das negative
          Randmaß hebt die Polsterung von FlatTaskRow auf, damit die Titel
          bündig unter der Überschrift stehen. */}
      <div className="-mx-3.5 divide-y divide-ink/8">{children}</div>
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
