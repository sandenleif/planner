import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Repeat, X } from 'lucide-react'
import clsx from 'clsx'
import type { Recurrence, Task, TaskPatch } from '@/data/types'
import { RECURRENCE_OPTIONS } from '@/data/recurrence'

const PRIORITIES: { value: number | null; label: string; className: string }[] = [
  { value: null, label: 'keine', className: 'text-muted' },
  // Muss zu PRIORITY_DOT in TaskRow.tsx passen: still fuer niedrig, Bernstein
  // fuer mittel, Rot fuer hoch. Blau faellt weg - das ist jetzt die Leitfarbe
  // und darf nicht nebenbei "niedrige Prioritaet" bedeuten.
  { value: 1, label: 'niedrig', className: 'text-muted' },
  { value: 2, label: 'mittel', className: 'text-amber-600' },
  { value: 3, label: 'hoch', className: 'text-red-600' },
]

/**
 * Ausklappbereich unter einer Aufgabe: Notizen, Wiederholung, Priorität.
 *
 * Bewusst inline statt als Seitenpanel oder Modal. Auf einem 400px breiten
 * Android-Bildschirm ist ein Seitenpanel kein Panel mehr, sondern ein
 * Vollbild - und dann muss man den Kontext wieder aus dem Kopf holen.
 */
export function TaskDetails({
  task,
  depth,
  onPatch,
  onClose,
}: {
  task: Task
  depth: number
  onPatch: (patch: TaskPatch) => void
  onClose: () => void
}) {
  const [notes, setNotes] = useState(task.notes ?? '')

  // Fremdaenderungen uebernehmen, solange hier nicht getippt wird.
  useEffect(() => {
    setNotes(task.notes ?? '')
  }, [task.notes])

  const commitNotes = () => {
    const value = notes.trim()
    if (value !== (task.notes ?? '')) onPatch({ notes: value || null })
  }

  return (
    <div
      className="mb-1 rounded-xl bg-sunken px-3 py-3"
      style={{ marginLeft: `${depth * 1.5 + 2.75}rem` }}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Details
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted transition-colors hover:bg-hover hover:text-ink"
          aria-label="Details schließen"
        >
          <X size={13} />
        </button>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commitNotes}
        onKeyDown={(e) => {
          // Strg+Enter speichert; ein blosses Enter soll eine Zeile umbrechen.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
          if (e.key === 'Escape') {
            setNotes(task.notes ?? '')
            e.currentTarget.blur()
          }
        }}
        rows={3}
        placeholder="Notizen …"
        className="w-full resize-y rounded-lg border border-subtle bg-panel px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent-500"
        aria-label="Notizen"
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Priorität">
          <div className="flex gap-1">
            {PRIORITIES.map((option) => (
              <button
                key={String(option.value)}
                onClick={() => onPatch({ priority: option.value })}
                className={clsx(
                  // py-2.5 auf dem Telefon: sonst sind die vier Knoepfe nur
                  // 28 Pixel hoch und liegen dicht nebeneinander.
                  'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors max-md:py-2.5',
                  task.priority === option.value
                    ? `bg-panel ${option.className} shadow-sm`
                    : 'text-muted hover:bg-hover',
                )}
                aria-pressed={task.priority === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Wiederholung">
          <div className="flex items-center gap-2">
            <Repeat size={14} className="shrink-0 text-muted" />
            <select
              value={task.recurrence ?? ''}
              onChange={(e) =>
                onPatch({
                  recurrence:
                    e.target.value === '' ? null : (e.target.value as Recurrence),
                })
              }
              className="min-w-0 flex-1 rounded-lg border border-subtle bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent-500"
              aria-label="Wiederholung"
            >
              <option value="">Einmalig</option>
              {RECURRENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {task.recurrence && !task.dueAt && (
            <p className="mt-1.5 text-[11px] text-amber-600">
              Ohne Fälligkeit startet die Wiederholung erst beim ersten Abhaken.
            </p>
          )}
        </Field>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </div>
  )
}
