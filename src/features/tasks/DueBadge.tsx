import { useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import clsx from 'clsx'
import { formatDueDate, isOverdue, toIsoDate } from '@/lib/date'

/**
 * Faelligkeit anzeigen und aendern - der Knopf mit dem Kalendersymbol.
 *
 * Eigene Datei, weil ihn zwei sehr verschiedene Orte brauchen: die Zeile im
 * Hauptfenster und dieselbe Zeile im Menueleisten-Panel. Zweimal gebaut waere
 * er zweimal zu pflegen, und die Mittagsregel unten ist genau die Art Detail,
 * die beim zweiten Mal fehlt.
 */
export function DueBadge({
  dueAt,
  allDay,
  done,
  onChange,
}: {
  dueAt: string | null
  allDay: boolean
  done: boolean
  onChange: (value: string | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const overdue = !done && isOverdue(dueAt)

  return (
    <span className="relative shrink-0">
      <button
        onClick={() => {
          const el = ref.current
          if (!el) return
          // showPicker() gibt es nicht ueberall; der Fokus auf das Feld
          // oeffnet den Kalender sonst als Rueckfallebene.
          if (typeof el.showPicker === 'function') el.showPicker()
          else el.focus()
        }}
        className={clsx(
          'flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors',
          dueAt
            ? overdue
              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'text-muted hover:bg-sunken'
            : 'text-muted hover:bg-sunken hover:text-ink',
        )}
        aria-label={dueAt ? 'Fälligkeit ändern' : 'Fälligkeit setzen'}
        title={dueAt ? 'Fälligkeit ändern' : 'Fälligkeit setzen'}
      >
        <CalendarDays size={13} />
        {dueAt && <span className="whitespace-nowrap">{formatDueDate(dueAt, allDay)}</span>}
      </button>

      <input
        ref={ref}
        type="date"
        value={dueAt ? toIsoDate(new Date(dueAt)) : ''}
        onChange={(e) => {
          const value = e.target.value
          // Mittag statt Mitternacht: so kippt ein Ganztagstermin nicht durch
          // Zeitzonenumrechnung auf den Vor- oder Folgetag.
          onChange(value ? new Date(`${value}T12:00:00`).toISOString() : null)
        }}
        className="pointer-events-none absolute inset-0 size-full opacity-0"
        tabIndex={-1}
        aria-hidden
      />
    </span>
  )
}
