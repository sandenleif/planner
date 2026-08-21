import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import clsx from 'clsx'
import { useToggleTaskDone } from '@/data/hooks'
import type { List, Task } from '@/data/types'
import { RECURRENCE_LABEL } from '@/data/recurrence'
import { formatDueDate, isOverdue } from '@/lib/date'
import { listColor } from '@/features/lists/listColors'

/** Muss zu PRIORITY_DOT in TaskRow.tsx passen. */
const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-muted/55',
  2: 'bg-amber-600',
  3: 'bg-red-600',
}

const PRIORITY_LABEL: Record<number, string> = {
  1: 'niedrig',
  2: 'mittel',
  3: 'hoch',
}

/**
 * Aufgabenzeile für listenübergreifende Ansichten (Heute, Demnächst).
 *
 * Ohne Baumbearbeitung und ohne Umsortieren: hier geht es ums Abarbeiten,
 * nicht ums Strukturieren. Das Strukturieren passiert in der Liste selbst.
 *
 * Gleicher Aufbau wie TaskRow: Titel führt, alles Weitere steht darunter als
 * ein Satz. Der Unterschied ist die Liste — hier gehört jede Zeile zu einer
 * anderen, und deshalb steht sie in der zweiten Zeile mit ihrem Farbpunkt.
 * Der Punkt ist es, den man nach zwei Tagen liest, nicht den Namen.
 *
 * Jede Zeile ist eine eigene Komponente, weil `useToggleTaskDone` die listId
 * braucht - die unterscheidet sich hier von Zeile zu Zeile.
 */
export function FlatTaskRow({
  task,
  list,
  showDate = true,
}: {
  task: Task
  list: List | undefined
  showDate?: boolean
}) {
  const toggleDone = useToggleTaskDone(task.listId)
  const accent = listColor(list?.color)
  const overdue = !task.done && isOverdue(task.dueAt)

  const meta: ReactNode[] = []

  if (showDate && task.dueAt) {
    meta.push(
      <span
        key="due"
        className={clsx('tabular-nums', overdue && 'font-semibold text-red-600 dark:text-red-400')}
      >
        {formatDueDate(task.dueAt, task.allDay)}
      </span>,
    )
  }

  if (list) {
    meta.push(
      <Link
        key="list"
        to={`/list/${list.id}`}
        className="flex items-center gap-1.5 transition-colors hover:text-ink"
      >
        <span className="size-[7px] shrink-0 rounded-sm" style={{ backgroundColor: accent }} />
        <span className="max-w-32 truncate">{list.name}</span>
      </Link>,
    )
  }

  if (task.recurrence) {
    meta.push(<span key="rec">{RECURRENCE_LABEL[task.recurrence].toLowerCase()}</span>)
  }

  return (
    <div className="group flex items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-hover">
      <button
        onClick={() => toggleDone.mutate(task)}
        className={clsx(
          'tap-target mt-px flex size-[21px] shrink-0 items-center justify-center rounded-[7px] border-2 transition-all',
          task.done ? 'border-transparent text-white' : 'border-muted/50 hover:border-current',
        )}
        style={task.done ? { backgroundColor: accent } : { color: accent }}
        aria-label={
          task.done ? `„${task.title}“ wieder öffnen` : `„${task.title}“ als erledigt markieren`
        }
        aria-pressed={task.done}
      >
        {task.done && <Check size={13} strokeWidth={3.5} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline">
          {task.priority ? (
            <span
              className={clsx(
                'mr-2 size-1.5 shrink-0 translate-y-[-2px] rounded-full',
                PRIORITY_DOT[task.priority],
              )}
              aria-label={`Priorität ${PRIORITY_LABEL[task.priority]}`}
            />
          ) : null}
          <span
            className={clsx(
              'min-w-0 flex-1 truncate text-task leading-snug',
              task.done && 'text-muted line-through decoration-muted/55',
            )}
          >
            {task.title}
          </span>
        </div>

        {meta.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-muted">
            {meta.map((part, index) => (
              <span key={index} className="flex items-center gap-1.5">
                {index > 0 && <span className="opacity-40">·</span>}
                {part}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
