import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  CornerDownRight,
  Flag,
  MoreHorizontal,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import type { TaskNode } from '@/data/types'
import { RECURRENCE_LABEL } from '@/data/recurrence'
import { subtreeProgress } from '@/data/tree'
import { formatDueDate, isOverdue } from '@/lib/date'
import { isTouchPrimary } from '@/lib/platform'
import { DueBadge } from './DueBadge'

/**
 * Der Prioritätspunkt vor dem Titel — Nachfolger des Fähnchens am Zeilenende.
 *
 * Ein Punkt vorne wird beim Lesen mitgenommen; ein Symbol hinten muss gesucht
 * werden. „Niedrig" bekommt bewusst einen eigenen, stillen Ton statt gar
 * nichts: Sonst wäre eine ausdrücklich als niedrig eingestufte Aufgabe von
 * einer ohne jede Angabe nicht zu unterscheiden.
 */
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

export interface TaskRowActions {
  onToggleDone(node: TaskNode): void
  onRename(node: TaskNode, title: string): void
  onDelete(node: TaskNode): void
  onAddSubtask(node: TaskNode): void
  onIndent(node: TaskNode): void
  onOutdent(node: TaskNode): void
  onCreateSibling(node: TaskNode): void
  onSetDue(node: TaskNode, dueAt: string | null): void
  onCyclePriority(node: TaskNode): void
  onToggleDetails(node: TaskNode): void
  /** Verschiebt die Aufgabe unter ihren Geschwistern. -1 = hoch, 1 = runter. */
  onMove(node: TaskNode, direction: -1 | 1): void
  /**
   * Oeffnet das Aktionsblatt - der Weg zu allem, wenn kein Zeiger und keine
   * Tastatur da sind. Siehe TaskActionSheet.
   */
  onOpenActions(node: TaskNode): void
}

/**
 * Eine Aufgabe.
 *
 * Zwei Zeilen statt einer: Der Titel bekommt die volle Breite, alles Weitere
 * steht darunter als ein Satz in einer Stimme. Vorher standen bis zu neun
 * Elemente nebeneinander — Dreieck, Haken, Titel, Notizpunkt, Fortschritt,
 * Datum, Wiederholung, Priorität, Menü —, und auf einem 360 Pixel breiten
 * Schirm blieb für den Titel der Rest.
 *
 * Der Unterschied zwischen Maus und Daumen liegt nur im Titel selbst:
 *
 * - Mit Maus ist er ein Eingabefeld. Tab rückt ein, Enter legt die nächste
 *   Aufgabe an, Alt+Pfeil verschiebt. Das ist schnell und soll bleiben.
 * - Mit Daumen ist er ein Knopf, der das Aktionsblatt öffnet. Ein Feld, in
 *   dem man mit ausgefahrener Tastatur in einer Liste tippt, ist der
 *   umständlichere Weg zu demselben Ziel.
 */
export function TaskRow({
  node,
  collapsed,
  onToggleCollapse,
  actions,
  accent,
  detailsOpen,
  autoFocus,
}: {
  node: TaskNode
  collapsed: boolean
  onToggleCollapse: () => void
  actions: TaskRowActions
  /** Farbe der Liste - faerbt den Haken und die Einrueckungslinie. */
  accent: string
  detailsOpen: boolean
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState(node.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fremdaenderungen (anderes Geraet, anderer Nutzer) uebernehmen - aber nur,
  // solange dieses Feld nicht gerade bearbeitet wird. Sonst springt einem der
  // Text beim Tippen unter den Fingern weg.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(node.title)
  }, [node.title])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const progress = subtreeProgress(node)
  const hasChildren = node.children.length > 0
  const overdue = !node.done && isOverdue(node.dueAt)

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== node.title) actions.onRename(node, trimmed)
    else if (!trimmed) setDraft(node.title)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      actions.onCreateSibling(node)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      commit()
      if (event.shiftKey) actions.onOutdent(node)
      else actions.onIndent(node)
      return
    }
    // Alt+Pfeil verschiebt die Zeile. Ohne Alt bleiben die Pfeiltasten fuer
    // den Textcursor im Feld - alles andere waere beim Korrigieren laestig.
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      commit()
      actions.onMove(node, event.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (event.key === 'Escape') {
      setDraft(node.title)
      inputRef.current?.blur()
      return
    }
    // Leere Zeile mit Backspace loeschen - so verschwindet eine versehentlich
    // erzeugte Aufgabe ohne Mausweg.
    if (event.key === 'Backspace' && draft === '' && !hasChildren) {
      event.preventDefault()
      actions.onDelete(node)
    }
  }

  /**
   * Die zweite Zeile.
   *
   * Nur vorhanden, wenn es etwas zu sagen gibt — eine erledigte Aufgabe ohne
   * Termin bleibt einzeilig. Eine dauerhaft leere zweite Zeile wäre nichts als
   * Luft zwischen den Aufgaben.
   */
  const meta: ReactNode[] = []

  if (node.dueAt) {
    meta.push(
      <span key="due" className={clsx(overdue && 'font-semibold text-red-600 dark:text-red-400')}>
        {formatDueDate(node.dueAt, node.allDay)}
      </span>,
    )
  }
  if (hasChildren) {
    meta.push(
      <span key="progress" className="tabular-nums">
        {progress.done} von {progress.total}
      </span>,
    )
  }
  if (node.recurrence) {
    meta.push(<span key="rec">{RECURRENCE_LABEL[node.recurrence].toLowerCase()}</span>)
  }
  if (node.notes) {
    meta.push(<span key="notes">Notiz</span>)
  }

  return (
    <div
      className={clsx(
        'group relative flex items-start gap-3 rounded-xl py-2.5 pr-1.5 transition-colors',
        !isTouchPrimary && 'hover:bg-hover',
      )}
      style={{ paddingLeft: `${node.depth * 1.5 + 0.5}rem` }}
    >
      {/* Senkrechte Spur je Verschachtelungsebene. Sie ersetzt die Frage
          „wo fängt das an, wozu das hier gehört" durch eine Linie. */}
      {node.depth > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-ink/12"
          style={{ left: `${(node.depth - 1) * 1.5 + 1.1875}rem` }}
        />
      )}

      <button
        onClick={onToggleCollapse}
        className={clsx(
          // Auf Touch grosszuegiger gepolstert statt mit .tap-target: Das
          // Dreieck steht direkt neben dem Haken, und zwei unsichtbare
          // Flaechen nebeneinander wuerden sich ueberlappen.
          'mt-px shrink-0 rounded p-0.5 text-muted transition-transform [@media(pointer:coarse)]:p-1.5',
          !hasChildren && 'invisible',
          !collapsed && 'rotate-90',
        )}
        aria-label={collapsed ? 'Unterpunkte zeigen' : 'Unterpunkte verbergen'}
        aria-expanded={!collapsed}
      >
        <ChevronRight size={14} />
      </button>

      <button
        onClick={() => actions.onToggleDone(node)}
        className={clsx(
          'tap-target mt-px flex size-[21px] shrink-0 items-center justify-center rounded-[7px] border-2 transition-all',
          node.done ? 'border-transparent text-white' : 'border-muted/50 hover:border-current',
        )}
        style={node.done ? { backgroundColor: accent } : { color: accent }}
        // Der Titel gehoert ins Label: sonst hoert ein Screenreader-Nutzer
        // in einer Liste mit zwanzig Aufgaben zwanzig Mal denselben Satz.
        aria-label={
          node.done
            ? `„${node.title}“ wieder öffnen`
            : `„${node.title}“ als erledigt markieren`
        }
        aria-pressed={node.done}
      >
        {node.done && <Check size={13} strokeWidth={3.5} />}
      </button>

      <div className="min-w-0 flex-1">
        {/*
          Der Titel ist IMMER ein Eingabefeld, auch auf dem Telefon.

          Eine Zeit lang war er dort ein Knopf, der das Aktionsblatt öffnete —
          und damit gab es keinen Weg mehr, eine Aufgabe umzubenennen. Schlimmer
          noch: „Unterpunkt hinzufügen" legt eine Aufgabe mit leerem Titel an,
          die auf den Fokus dieses Feldes wartet. Ohne Feld entstand eine Zeile,
          die sich nie benennen ließ.

          Ein Tipp setzt jetzt den Cursor hinein und die Tastatur fährt auf —
          derselbe Handgriff wie in jeder Notiz-App. Enter legt gleich die
          nächste Aufgabe an, deshalb enterKeyHint="next": Die Tastatur zeigt
          dann einen Weiter-Pfeil statt eines Häkchens.
        */}
        <div className="flex items-baseline">
          {node.priority ? (
            <span
              className={clsx(
                'mr-2 size-1.5 shrink-0 translate-y-[-2px] rounded-full',
                PRIORITY_DOT[node.priority],
              )}
              aria-label={`Priorität ${PRIORITY_LABEL[node.priority]}`}
            />
          ) : null}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            enterKeyHint="next"
            placeholder="Aufgabe"
            className={clsx(
              'min-w-0 flex-1 bg-transparent py-0 text-task leading-snug outline-none placeholder:text-muted/70',
              node.done && 'text-muted line-through decoration-muted/55',
            )}
            aria-label="Aufgabentitel"
          />
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

      {/*
        Auf Touch genau EIN Knopf, und der öffnet das Aktionsblatt.

        Fünf Symbole nebeneinander waren zu viel: Sie standen dauerhaft im Bild
        (es gibt kein Überfahren), drückten den Titel in die Enge und waren mit
        26 Pixeln zu klein zum Treffen. Einer ist etwas anderes — er nimmt kaum
        Platz, ist mit tap-target sicher zu treffen, und ohne ihn gäbe es auf
        dem Telefon keinen Weg zu Einrücken, Verschieben und Löschen.
      */}
      {isTouchPrimary && (
        <button
          onClick={() => actions.onOpenActions(node)}
          className="tap-target mt-px shrink-0 rounded-lg p-1.5 text-muted transition-colors active:bg-sunken"
          aria-label={`Aktionen für „${node.title || 'Aufgabe ohne Titel'}“`}
        >
          <MoreHorizontal size={18} />
        </button>
      )}

      {!isTouchPrimary && (
        <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!node.dueAt && (
            <DueBadge
              dueAt={null}
              allDay
              done={node.done}
              onChange={(value) => actions.onSetDue(node, value)}
            />
          )}
          <IconAction label="Priorität ändern" onClick={() => actions.onCyclePriority(node)}>
            <Flag size={13} />
          </IconAction>
          <IconAction
            label={detailsOpen ? 'Details schließen' : 'Details öffnen'}
            onClick={() => actions.onToggleDetails(node)}
            className={clsx(detailsOpen && 'bg-sunken text-ink')}
          >
            <SlidersHorizontal size={13} />
          </IconAction>
          <IconAction label="Unterpunkt hinzufügen" onClick={() => actions.onAddSubtask(node)}>
            <CornerDownRight size={13} />
          </IconAction>
          <IconAction
            label="Löschen"
            onClick={() => actions.onDelete(node)}
            className="hover:text-red-600"
          >
            <Trash2 size={13} />
          </IconAction>
        </div>
      )}
    </div>
  )
}

function IconAction({
  children,
  label,
  onClick,
  className,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        'rounded-md p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}
