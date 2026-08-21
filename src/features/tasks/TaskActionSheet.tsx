import { useRef } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CornerDownRight,
  Flag,
  IndentDecrease,
  IndentIncrease,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import type { TaskNode } from '@/data/types'
import { dueFromDateInput, formatDueDate, toIsoDate } from '@/lib/date'
import { Dialog } from '@/ui/Dialog'
import type { TaskRowActions } from './TaskRow'

const PRIORITY_LABEL: Record<number, string> = {
  1: 'niedrig',
  2: 'mittel',
  3: 'hoch',
}

/** Was mit dieser Aufgabe gerade überhaupt möglich ist. */
export interface TaskAbilities {
  indent: boolean
  outdent: boolean
  up: boolean
  down: boolean
}

/**
 * Alle Befehle einer Aufgabe, mit Namen statt als Symbolreihe.
 *
 * Auf dem Desktop stehen sie rechts in der Zeile: vier kleine Symbole, die beim
 * Überfahren erscheinen. Auf einem Telefon funktioniert das aus zwei Gründen
 * nicht. Es gibt kein Überfahren — die Symbole standen deshalb dauerhaft da und
 * drängten den Titel auf einem 360 Pixel breiten Schirm in die Enge. Und sie
 * waren 26 Pixel groß; Android nennt 48 als Untergrenze für etwas, das ein
 * Daumen sicher trifft.
 *
 * Hier bekommt jeder Befehl eine eigene Zeile mit Namen. Das kostet einen Tipp
 * mehr und ist trotzdem schneller, weil man nicht rät, was ein Symbol bedeutet.
 *
 * Nebenbei schließt das eine Lücke: Einrücken, Ausrücken und Verschieben gab es
 * bisher NUR über Tab, Shift+Tab und Alt+Pfeil. Auf einem Telefon ohne
 * Tastatur waren Unterpunkte damit unerreichbar — in einer App, deren
 * Unterpunkte zum Kern gehören.
 */
export function TaskActionSheet({
  node,
  abilities,
  detailsOpen,
  actions,
  onClose,
}: {
  node: TaskNode
  abilities: TaskAbilities
  detailsOpen: boolean
  actions: TaskRowActions
  onClose: () => void
}) {
  const dateRef = useRef<HTMLInputElement>(null)

  const openDatePicker = () => {
    const el = dateRef.current
    if (!el) return
    // Wie im Kalendersymbol der Zeile: showPicker gibt es nicht überall.
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={node.title.trim() || 'Aufgabe ohne Titel'}
      description={node.done ? 'Erledigt' : undefined}
    >
      <div className="-mx-2 flex flex-col">
        <Row
          icon={<SlidersHorizontal size={18} />}
          label={detailsOpen ? 'Details schließen' : 'Details öffnen'}
          onClick={() => {
            actions.onToggleDetails(node)
            onClose()
          }}
        />

        <Row
          icon={<CornerDownRight size={18} />}
          label="Unterpunkt hinzufügen"
          onClick={() => {
            actions.onAddSubtask(node)
            onClose()
          }}
        />

        {/* Bleibt offen: Wer die Fälligkeit setzt, ändert oft gleich noch die
            Priorität. Das Blatt zweimal aufzuziehen wäre unnötige Arbeit.

            Das Datumsfeld liegt unsichtbar GENAU über dieser Zeile, so wie beim
            Kalendersymbol in der Aufgabenzeile. Ein Feld ohne Ausdehnung
            irgendwo im Blatt täte es nicht zuverlässig: showPicker() verlangt
            ein tatsächlich dargestelltes Element, und wo das nicht klappt,
            bleibt als Rückfall der Fokus – der auf einem Feld ohne Fläche
            nirgendwohin führt. */}
        <span className="relative flex">
          <Row
            icon={<CalendarDays size={18} />}
            label={node.dueAt ? 'Fällig ändern' : 'Fällig setzen'}
            hint={node.dueAt ? formatDueDate(node.dueAt, node.allDay) : undefined}
            onClick={openDatePicker}
            grow
          />
          <input
            ref={dateRef}
            type="date"
            value={node.dueAt ? toIsoDate(new Date(node.dueAt)) : ''}
            onChange={(event) => actions.onSetDue(node, dueFromDateInput(event.target.value))}
            className="pointer-events-none absolute inset-0 size-full opacity-0"
            tabIndex={-1}
            aria-hidden
          />
        </span>

        <Row
          icon={<Flag size={18} />}
          label="Priorität"
          hint={node.priority ? PRIORITY_LABEL[node.priority] : 'keine'}
          onClick={() => actions.onCyclePriority(node)}
        />

        <Separator />

        <Row
          icon={<IndentIncrease size={18} />}
          label="Einrücken"
          hint="wird Unterpunkt darüber"
          disabled={!abilities.indent}
          onClick={() => actions.onIndent(node)}
        />

        <Row
          icon={<IndentDecrease size={18} />}
          label="Ausrücken"
          disabled={!abilities.outdent}
          onClick={() => actions.onOutdent(node)}
        />

        <Row
          icon={<ArrowUp size={18} />}
          label="Nach oben"
          disabled={!abilities.up}
          onClick={() => actions.onMove(node, -1)}
        />

        <Row
          icon={<ArrowDown size={18} />}
          label="Nach unten"
          disabled={!abilities.down}
          onClick={() => actions.onMove(node, 1)}
        />

        <Separator />

        <Row
          icon={<Trash2 size={18} />}
          label="Löschen"
          danger
          onClick={() => {
            actions.onDelete(node)
            onClose()
          }}
        />
      </div>
    </Dialog>
  )
}

function Row({
  icon,
  label,
  hint,
  onClick,
  disabled,
  danger,
  grow,
}: {
  icon: ReactNode
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  /** Fuellt einen umgebenden Flex-Container - fuer die Zeile mit Datumsfeld. */
  grow?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        // min-h-12 statt einer festen Höhe: Ein langer Hinweis darf umbrechen,
        // ohne dass der Text aus der Zeile läuft.
        'flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
        grow && 'flex-1',
        disabled
          ? 'cursor-not-allowed text-muted/45'
          : danger
            ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
            : 'text-ink hover:bg-hover',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="shrink-0 text-xs text-muted">{hint}</span>}
    </button>
  )
}

function Separator() {
  return <span className="my-1.5 h-px bg-subtle" aria-hidden />
}
