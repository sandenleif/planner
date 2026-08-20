import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUpRight, Check, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthProvider'
import { useAllTasks, useCreateTask, useLists, useToggleTaskDone } from '@/data/hooks'
import type { List, Task } from '@/data/types'
import { formatDueDate, isOverdue, todayIso } from '@/lib/date'
import { sortByPosition } from '@/lib/ordering'
import { listColor } from '@/features/lists/listColors'
import { parseQuickAdd } from '@/lib/parseQuickAdd'
import { openMainWindow } from '@/lib/desktop'

/**
 * Die Menüleisten-Ansicht: das, was aus dem Tray-Symbol aufklappt.
 *
 * Bewusst eine eigene Route und kein verkleinertes Hauptfenster. Was man in
 * einem Menüleisten-Panel tut, ist ein sehr kurzer Vorgang: nachsehen, was
 * heute ansteht, einen Haken setzen, etwas notieren. Alles andere — Listen
 * umbauen, Unterpunkte sortieren, teilen — gehört ins Hauptfenster, und
 * dorthin führt genau ein Knopf.
 *
 * Deshalb steht hier auch keine Navigation: ein Panel, aus dem man
 * herausnavigiert, ist ein Fenster mit falschem Rahmen.
 */
export function PanelPage() {
  const auth = useAuth()
  const { data: lists = [] } = useLists()
  const { data: tasks = [] } = useAllTasks()
  const [draft, setDraft] = useState('')

  const today = todayIso()
  const sortedLists = useMemo(() => sortByPosition(lists), [lists])
  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists])

  // Die Liste, in der die Schnellerfassung landet: die erste, sofern der
  // Text nicht per #name etwas anderes sagt.
  const parsed = parseQuickAdd(draft)
  const targetList =
    (parsed.listHint
      ? sortedLists.find((l) =>
          l.name.toLowerCase().startsWith(parsed.listHint!.toLowerCase()),
        )
      : undefined) ?? sortedLists[0]

  const createTask = useCreateTask(targetList?.id ?? '')

  const dueToday = useMemo(() => {
    const limit = new Date(`${today}T23:59:59.999`).getTime()
    return tasks
      .filter((t) => !t.done && t.dueAt !== null && new Date(t.dueAt).getTime() <= limit)
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
  }, [tasks, today])

  const openCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of tasks) {
      if (task.done) continue
      map.set(task.listId, (map.get(task.listId) ?? 0) + 1)
    }
    return map
  }, [tasks])

  const submit = () => {
    if (!parsed.title || !targetList) return
    createTask.mutate({
      title: parsed.title,
      dueAt: parsed.dueAt,
      allDay: parsed.allDay,
      priority: parsed.priority,
      recurrence: parsed.recurrence,
    })
    setDraft('')
  }

  if (auth.mode === 'supabase' && !auth.userId) {
    return <PanelSignedOut loading={auth.loading} />
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <header
        className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3.5"
        data-tauri-drag-region
      >
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted">
            {new Intl.DateTimeFormat('de-DE', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }).format(new Date())}
          </p>
          <h1 className="text-base font-semibold">
            {dueToday.length === 0
              ? 'Nichts fällig'
              : `${dueToday.length} ${dueToday.length === 1 ? 'Aufgabe' : 'Aufgaben'} heute`}
          </h1>
        </div>

        <button
          onClick={() => void openMainWindow()}
          className="btn-ghost shrink-0 px-2"
          aria-label="Im Hauptfenster öffnen"
          title="Im Hauptfenster öffnen"
        >
          <ArrowUpRight size={16} />
        </button>
      </header>

      <div className="shrink-0 px-4 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-subtle bg-panel px-3 py-2 focus-within:border-accent-500">
          <Plus size={15} className="shrink-0 text-muted" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setDraft('')
            }}
            placeholder={
              targetList ? `Notieren in „${targetList.name}“ …` : 'Erst eine Liste anlegen'
            }
            disabled={!targetList}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            aria-label="Schnell notieren"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {dueToday.length > 0 && (
          <ul className="mb-3 flex flex-col">
            {dueToday.slice(0, 6).map((task) => (
              <PanelTask key={task.id} task={task} list={listById.get(task.listId)} />
            ))}
          </ul>
        )}

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Listen
        </p>

        <div className="grid grid-cols-2 gap-2">
          {sortedLists.map((list) => (
            <button
              key={list.id}
              onClick={() => void openMainWindow(`/list/${list.id}`)}
              className="tile min-h-16 justify-between p-3 text-left"
              style={{ '--tile-color': listColor(list.color) } as CSSProperties}
            >
              <span className="truncate text-[13px] font-semibold leading-tight">
                {list.name}
              </span>
              <span className="text-lg font-semibold tabular-nums leading-none">
                {openCounts.get(list.id) ?? 0}
              </span>
            </button>
          ))}
        </div>

        {sortedLists.length === 0 && (
          <p className="py-6 text-center text-xs text-muted">
            Noch keine Liste — im Hauptfenster anlegen.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Was das Panel zeigt, solange niemand angemeldet ist.
 *
 * Bewusst kein Anmeldeformular: ein Passwortfeld in einem randlosen Popover,
 * das beim kleinsten Klick daneben verschwindet, ist eine Einladung zum
 * Frustrieren. Der Weg führt ins Hauptfenster.
 */
function PanelSignedOut({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-app px-8 text-center">
      {loading ? (
        <p className="text-sm text-muted">Einen Moment …</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Für deine Listen musst du angemeldet sein.
          </p>
          <button className="btn-primary" onClick={() => void openMainWindow()}>
            Im Hauptfenster anmelden
          </button>
        </>
      )}
    </div>
  )
}

function PanelTask({ task, list }: { task: Task; list: List | undefined }) {
  const toggleDone = useToggleTaskDone(task.listId)
  const accent = listColor(list?.color)
  const overdue = isOverdue(task.dueAt)

  return (
    <li className="group -mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-hover">
      <button
        onClick={() => toggleDone.mutate(task)}
        className="flex size-[17px] shrink-0 items-center justify-center rounded-md border-2 border-muted/45 transition-colors hover:border-current"
        style={{ color: accent }}
        aria-label={`„${task.title}“ als erledigt markieren`}
      >
        <Check size={11} strokeWidth={3.5} className="opacity-0 group-hover:opacity-40" />
      </button>

      <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>

      {overdue && (
        <span className="shrink-0 text-[10px] font-medium text-red-600">
          {formatDueDate(task.dueAt!, task.allDay)}
        </span>
      )}

      {list && (
        <span
          className={clsx('size-2 shrink-0 rounded-full')}
          style={{ backgroundColor: accent }}
          title={list.name}
        />
      )}
    </li>
  )
}
