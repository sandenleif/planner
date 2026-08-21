import { Link } from 'react-router-dom'
import { Check, Flag, Repeat } from 'lucide-react'
import clsx from 'clsx'
import { useToggleTaskDone } from '@/data/hooks'
import type { List, Task } from '@/data/types'
import { RECURRENCE_LABEL } from '@/data/recurrence'
import { formatDueDate, isOverdue } from '@/lib/date'
import { listColor } from '@/features/lists/listColors'

const PRIORITY_STYLE: Record<number, string> = {
  1: 'text-sky-600',
  2: 'text-amber-600',
  3: 'text-red-600',
}

/**
 * Aufgabenzeile für listenübergreifende Ansichten (Heute, Demnächst).
 *
 * Ohne Baumbearbeitung und ohne Umsortieren: hier geht es ums Abarbeiten,
 * nicht ums Strukturieren. Das Strukturieren passiert in der Liste selbst.
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

  return (
    <div className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-hover">
      <button
        onClick={() => toggleDone.mutate(task)}
        className={clsx(
          'tap-target flex size-5 shrink-0 items-center justify-center rounded-[7px] border-2 transition-all',
          task.done ? 'border-transparent text-white' : 'border-muted/45 hover:border-current',
        )}
        style={task.done ? { backgroundColor: accent } : { color: accent }}
        aria-label={
          task.done ? `„${task.title}“ wieder öffnen` : `„${task.title}“ als erledigt markieren`
        }
        aria-pressed={task.done}
      >
        {task.done && <Check size={13} strokeWidth={3.5} />}
      </button>

      <span
        className={clsx(
          'min-w-0 flex-1 truncate text-[0.9375rem]',
          task.done && 'text-muted line-through decoration-muted/60',
        )}
      >
        {task.title}
      </span>

      {task.recurrence && (
        <Repeat
          size={12}
          className="shrink-0 text-muted"
          aria-label={`Wiederholt sich ${RECURRENCE_LABEL[task.recurrence].toLowerCase()}`}
        />
      )}

      {task.priority ? (
        <Flag
          size={12}
          fill="currentColor"
          className={clsx('shrink-0', PRIORITY_STYLE[task.priority])}
          aria-label={`Priorität ${task.priority}`}
        />
      ) : null}

      {showDate && task.dueAt && (
        <span
          className={clsx(
            'shrink-0 text-xs tabular-nums',
            overdue ? 'font-medium text-red-600' : 'text-muted',
          )}
        >
          {formatDueDate(task.dueAt, task.allDay)}
        </span>
      )}

      {list && (
        <Link
          to={`/list/${list.id}`}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: accent }} />
          <span className="max-w-28 truncate">{list.name}</span>
        </Link>
      )}
    </div>
  )
}
