import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarDays, Flag, Plus, Repeat, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import type { NewTask } from '@/data/types'
import { RECURRENCE_LABEL } from '@/data/recurrence'
import { formatDueDate } from '@/lib/date'
import { parseQuickAdd } from '@/lib/parseQuickAdd'

const PRIORITY_LABEL = ['', 'niedrig', 'mittel', 'hoch']

/**
 * Eingabefeld mit Sprachverständnis.
 *
 * Der Parser läuft bei jedem Tastendruck, aber nur zur Anzeige - übernommen
 * wird erst mit Enter. Das ist wichtig: man sieht vorher, was die App
 * verstanden hat, statt hinterher zu rätseln, warum "morgen" im Titel fehlt.
 */
export function QuickAdd({
  accent,
  onSubmit,
  autoFocusRef,
}: {
  accent: string
  onSubmit: (task: Omit<NewTask, 'listId'>) => void
  autoFocusRef?: (el: HTMLInputElement | null) => void
}) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseQuickAdd(text), [text])

  const submit = () => {
    if (!parsed.title) return
    onSubmit({
      title: parsed.title,
      dueAt: parsed.dueAt,
      allDay: parsed.allDay,
      priority: parsed.priority,
      recurrence: parsed.recurrence,
    })
    setText('')
  }

  const hasHints =
    parsed.dueAt !== null || parsed.priority !== null || parsed.recurrence !== null

  return (
    <div>
      {/* Vorschau ÜBER dem Feld, nicht darunter: Das Feld klebt am unteren
          Rand, alles darunter läge außerhalb des Bildes. Und nur, wenn
          wirklich etwas erkannt wurde — eine dauerhaft sichtbare leere Zeile
          wäre nichts als Unruhe. */}
      {hasHints && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          <Sparkles size={12} className="text-muted" />
          <span className="mr-0.5 text-meta text-muted">erkannt:</span>

          {parsed.dueAt && (
            <Chip icon={<CalendarDays size={11} />}>
              {formatDueDate(parsed.dueAt, parsed.allDay)}
            </Chip>
          )}
          {parsed.recurrence && (
            <Chip icon={<Repeat size={11} />}>{RECURRENCE_LABEL[parsed.recurrence]}</Chip>
          )}
          {parsed.priority && (
            <Chip icon={<Flag size={11} />}>{PRIORITY_LABEL[parsed.priority]}</Chip>
          )}
        </div>
      )}

      <div
        className="flex items-center gap-2.5 rounded-[15px] border border-subtle bg-panel px-4 py-3 shadow-card transition-colors focus-within:border-current"
        style={{ color: accent }}
      >
        <Plus size={18} className="shrink-0" strokeWidth={2.4} />
        <input
          ref={autoFocusRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') {
              setText('')
              e.currentTarget.blur()
            }
          }}
          placeholder="Aufgabe hinzufügen — z. B. „Steuer morgen !!“"
          className="min-w-0 flex-1 bg-transparent text-task text-ink outline-none placeholder:text-muted"
          aria-label="Neue Aufgabe"
        />
      </div>

      {/* Die ausführliche Erklärung nur mit Zeiger. Auf dem Telefon steht die
          Eingabe knapp über der Tastatur; drei Zeilen Kleingedrucktes darunter
          wären dort im Weg. Was sie erklärt, steht ohnehin im Platzhalter. */}
      {!hasHints && text.length === 0 && (
        <p className="mt-2 px-1 text-meta text-muted [@media(pointer:coarse)]:hidden">
          Versteht „morgen“, „jeden montag“, „am 5.12. um 14:30“, „in 3 tagen“
          und <code className="rounded bg-sunken px-1 py-0.5">!</code> bis{' '}
          <code className="rounded bg-sunken px-1 py-0.5">!!!</code> für die Priorität.
        </p>
      )}
    </div>
  )
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md bg-accent-100 px-1.5 py-0.5',
        'text-[11px] font-medium text-accent-800',
        'dark:bg-accent-900/50 dark:text-accent-200',
      )}
    >
      {icon}
      {children}
    </span>
  )
}
