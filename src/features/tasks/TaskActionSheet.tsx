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
import { RECURRENCE_LABEL } from '@/data/recurrence'
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
      {/*
        Drei Blöcke in dieser Reihenfolge: was die Aufgabe IST, wo sie STEHT,
        und ganz unten mit Abstand das, was sie beendet. Löschen zwischen
        „Einrücken" und „Nach unten" wäre eine Falle für den Daumen.

        Rechts steht jeweils der aktuelle Zustand. „Fällig — Gestern" sagt
        beides in einer Zeile: was es ist und dass man es ändern kann.
      */}
      <div className="-mx-2 flex flex-col">

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
            label="Fällig"
            // Auch wenn nichts gesetzt ist, steht rechts etwas. Eine leere
            // rechte Spalte sieht aus wie ein Wert, der noch lädt.
            hint={node.dueAt ? formatDueDate(node.dueAt, node.allDay) : 'kein Termin'}
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

        <Row
          icon={<SlidersHorizontal size={18} />}
          label={detailsOpen ? 'Details schließen' : 'Notiz und Wiederholung'}
          hint={detailSummary(node)}
          onClick={() => {
            actions.onToggleDetails(node)
            onClose()
          }}
        />

        <Separator />

        <Row
          icon={<CornerDownRight size={18} />}
          label="Unterpunkt hinzufügen"
          onClick={() => {
            actions.onAddSubtask(node)
            onClose()
          }}
        />

        {/* Was gerade nicht geht, bleibt sichtbar und sagt warum. Ein Punkt,
            der einfach fehlt, lässt einen suchen, ob man ihn übersehen hat. */}
        <Row
          icon={<IndentIncrease size={18} />}
          label="Einrücken"
          hint={abilities.indent ? 'unter die Aufgabe darüber' : 'nichts darüber'}
          disabled={!abilities.indent}
          onClick={() => actions.onIndent(node)}
        />

        <Row
          icon={<IndentDecrease size={18} />}
          label="Ausrücken"
          hint={abilities.outdent ? undefined : 'schon ganz außen'}
          disabled={!abilities.outdent}
          onClick={() => actions.onOutdent(node)}
        />

        <Row
          icon={<ArrowUp size={18} />}
          label="Nach oben"
          hint={abilities.up ? undefined : 'steht bereits oben'}
          disabled={!abilities.up}
          onClick={() => actions.onMove(node, -1)}
        />

        <Row
          icon={<ArrowDown size={18} />}
          label="Nach unten"
          hint={abilities.down ? undefined : 'steht bereits unten'}
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

/**
 * Was hinter „Details" steckt, ohne dass man es aufklappen muss.
 *
 * Notiz und Wiederholung sind die einzigen beiden Dinge dort. Sie hier zu
 * nennen erspart in den meisten Fällen den Umweg — und wenn nichts gesetzt
 * ist, sagt das Blatt das auch, statt schweigend auf einen leeren Bereich zu
 * verweisen.
 */
function detailSummary(node: TaskNode): string {
  const parts: string[] = []
  if (node.notes) parts.push('Notiz')
  if (node.recurrence) parts.push(RECURRENCE_LABEL[node.recurrence].toLowerCase())
  return parts.length > 0 ? parts.join(' · ') : 'nichts gesetzt'
}
