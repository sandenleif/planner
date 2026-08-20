import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, CheckCircle2, CornerDownLeft, List, Search } from 'lucide-react'
import clsx from 'clsx'
import { useAllTasks, useLists } from '@/data/hooks'
import type { List as TaskList, Task } from '@/data/types'
import { formatDueDate } from '@/lib/date'
import { listColor } from '@/features/lists/listColors'
import { modKeyLabel } from '@/lib/platform'

type Result =
  | { kind: 'list'; list: TaskList }
  | { kind: 'task'; task: Task; list: TaskList | undefined }

const MAX_RESULTS = 12

/**
 * Suche über alles, per Strg/Cmd+K.
 *
 * Ab der zweiten Liste ist die Seitenleiste kein Suchwerkzeug mehr - man
 * weiß, wie die Aufgabe heißt, aber nicht mehr, wo sie liegt. Genau dafür
 * ist das hier da: tippen, Enter, dort sein.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { data: lists = [] } = useLists()
  const { data: tasks = [] } = useAllTasks()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists])

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase()

    if (!needle) {
      // Ohne Eingabe die Listen zeigen - so ist die Palette auch ein
      // Sprungbrett und nicht nur ein Suchfeld.
      return lists.map((list) => ({ kind: 'list' as const, list }))
    }

    const matchedLists: Result[] = lists
      .filter((l) => l.name.toLowerCase().includes(needle))
      .map((list) => ({ kind: 'list' as const, list }))

    const matchedTasks: Result[] = tasks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          (t.notes?.toLowerCase().includes(needle) ?? false),
      )
      // Offene vor erledigten, sonst verstopft altes Zeug die Trefferliste.
      .sort((a, b) => Number(a.done) - Number(b.done))
      .map((task) => ({ kind: 'task' as const, task, list: listById.get(task.listId) }))

    return [...matchedLists, ...matchedTasks].slice(0, MAX_RESULTS)
  }, [query, lists, tasks, listById])

  // Auswahl zurücksetzen, sobald sich die Trefferliste ändert - sonst zeigt
  // der Marker auf einen Eintrag, den es nicht mehr gibt.
  useEffect(() => setActive(0), [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // Nach dem Einblenden fokussieren, sonst greift der Fokus ins Leere.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Aktiven Eintrag im Sichtfeld halten.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const choose = (result: Result | undefined) => {
    if (!result) return
    const target = result.kind === 'list' ? result.list.id : result.task.listId
    void navigate(`/list/${target}`)
    onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]"
      style={{ animation: 'overlay-in 140ms ease-out' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Suche"
        className="card w-full max-w-xl overflow-hidden p-0"
        style={{ animation: 'palette-in 160ms cubic-bezier(0.2, 0, 0.2, 1)' }}
      >
        <div className="flex items-center gap-3 border-b border-subtle px-4 py-3">
          <Search size={17} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Aufgaben und Listen durchsuchen …"
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted"
            aria-label="Suchbegriff"
            aria-controls="palette-results"
            aria-activedescendant={`palette-item-${active}`}
          />
          <kbd className="shrink-0 rounded-md border border-subtle px-1.5 py-0.5 text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            Nichts gefunden für „{query}“.
          </p>
        ) : (
          <ul
            ref={listRef}
            id="palette-results"
            role="listbox"
            className="max-h-[45vh] overflow-y-auto py-1.5"
          >
            {results.map((result, index) => (
              <li
                key={result.kind === 'list' ? `l-${result.list.id}` : `t-${result.task.id}`}
                id={`palette-item-${index}`}
                role="option"
                aria-selected={index === active}
              >
                <button
                  onClick={() => choose(result)}
                  onMouseMove={() => setActive(index)}
                  className={clsx(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    index === active ? 'bg-hover' : 'hover:bg-hover',
                  )}
                >
                  {result.kind === 'list' ? (
                    <>
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: listColor(result.list.color) }}
                      >
                        <List size={14} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {result.list.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted">Liste</span>
                    </>
                  ) : (
                    <>
                      <span
                        className={clsx(
                          'flex size-7 shrink-0 items-center justify-center rounded-lg',
                          result.task.done ? 'text-accent-600' : 'text-muted',
                        )}
                      >
                        <CheckCircle2 size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={clsx(
                            'block truncate text-sm',
                            result.task.done && 'text-muted line-through',
                          )}
                        >
                          {result.task.title}
                        </span>
                        {result.task.dueAt && (
                          <span className="flex items-center gap-1 text-[11px] text-muted">
                            <CalendarClock size={10} />
                            {formatDueDate(result.task.dueAt, result.task.allDay)}
                          </span>
                        )}
                      </span>
                      {result.list && (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: listColor(result.list.color) }}
                          />
                          {result.list.name}
                        </span>
                      )}
                    </>
                  )}

                  {index === active && (
                    <CornerDownLeft size={13} className="shrink-0 text-muted" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-subtle px-4 py-2 text-[11px] text-muted">
          <span>↑↓ wählen</span>
          <span>↵ öffnen</span>
          <span className="ml-auto">{modKeyLabel}+K</span>
        </div>
      </div>
    </div>
  )
}
