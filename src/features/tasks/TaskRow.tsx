import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronRight,
  CornerDownRight,
  Flag,
  Repeat,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import type { TaskNode } from '@/data/types'
import { RECURRENCE_LABEL } from '@/data/recurrence'
import { subtreeProgress } from '@/data/tree'
import { formatDueDate, isOverdue, toIsoDate } from '@/lib/date'

const PRIORITY_STYLE: Record<number, string> = {
  1: 'text-sky-600',
  2: 'text-amber-600',
  3: 'text-red-600',
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
}

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

  return (
    <div
      className="group relative flex items-center gap-2 rounded-xl py-1.5 pr-1.5 transition-colors hover:bg-hover"
      style={{ paddingLeft: `${node.depth * 1.5 + 0.5}rem` }}
    >
      {/* Senkrechte Linie je Verschachtelungsebene. Ohne sie verliert man ab
          der zweiten Ebene den Überblick, was zu wem gehört. */}
      {node.depth > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px opacity-25"
          style={{
            left: `${(node.depth - 1) * 1.5 + 1.25}rem`,
            backgroundColor: accent,
          }}
        />
      )}

      <button
        onClick={onToggleCollapse}
        className={clsx(
          'shrink-0 rounded p-0.5 text-muted transition-transform',
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
          'flex size-5 shrink-0 items-center justify-center rounded-[7px] border-2 transition-all',
          node.done ? 'border-transparent text-white' : 'border-muted/45 hover:border-current',
        )}
        style={
          node.done
            ? { backgroundColor: accent }
            : { color: accent }
        }
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

      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={clsx(
          'min-w-0 flex-1 bg-transparent px-0.5 py-0.5 text-[0.9375rem] outline-none',
          node.done && 'text-muted line-through decoration-muted/60',
        )}
        aria-label="Aufgabentitel"
      />

      {node.notes && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-muted/50"
          title="Hat Notizen"
          aria-label="Hat Notizen"
        />
      )}

      {hasChildren && (
        <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[11px] tabular-nums text-muted">
          {progress.done}/{progress.total}
        </span>
      )}

      {node.dueAt && (
        <DueBadge
          dueAt={node.dueAt}
          allDay={node.allDay}
          done={node.done}
          onChange={(value) => actions.onSetDue(node, value)}
        />
      )}

      {node.recurrence && (
        <span
          className="flex shrink-0 items-center gap-1 rounded-md bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-muted"
          title={`Wiederholt sich ${RECURRENCE_LABEL[node.recurrence].toLowerCase()}`}
        >
          <Repeat size={11} />
        </span>
      )}

      {node.priority ? (
        <button
          onClick={() => actions.onCyclePriority(node)}
          className={clsx('shrink-0 rounded p-1', PRIORITY_STYLE[node.priority])}
          aria-label={`Priorität ${PRIORITY_LABEL[node.priority]} — ändern`}
          title={`Priorität: ${PRIORITY_LABEL[node.priority]}`}
        >
          <Flag size={13} fill="currentColor" />
        </button>
      ) : null}

      {/* Auf Touch-Geraeten gibt es kein Hover - dort bleiben die Aktionen
          dauerhaft schwach sichtbar. */}
      <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-55">
        {!node.dueAt && (
          <DueBadge
            dueAt={null}
            allDay
            done={node.done}
            onChange={(value) => actions.onSetDue(node, value)}
          />
        )}
        {!node.priority && (
          <IconAction label="Priorität setzen" onClick={() => actions.onCyclePriority(node)}>
            <Flag size={13} />
          </IconAction>
        )}
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

function DueBadge({
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
