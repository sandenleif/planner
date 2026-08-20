import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, Pin, PinOff, Plus, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthProvider'
import { qk, useAllTasks, useCreateTask, useLists, useToggleTaskDone } from '@/data/hooks'
import type { List, Task } from '@/data/types'
import { formatDueDate, isOverdue, todayIso } from '@/lib/date'
import { sortByPosition } from '@/lib/ordering'
import { listColor } from '@/features/lists/listColors'
import { parseQuickAdd } from '@/lib/parseQuickAdd'
import {
  hidePanel,
  isPanelPinned,
  onPanelShown,
  openMainWindow,
  setPanelPinned,
  watchPanelPosition,
} from '@/lib/desktop'

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
 *
 * Angeheftet (Stecknadel oben rechts) bleibt dasselbe Fenster stehen, statt
 * beim Klick daneben zu verschwinden. Das ist der Widget-Modus: dieselbe
 * Ansicht, nur dauerhaft auf dem Schreibtisch statt kurz aufgeklappt. Bewusst
 * kein zweites Fenster dafür — es wäre dieselbe Ansicht mit einem zweiten Satz
 * Fehlerquellen.
 */
export function PanelPage() {
  const auth = useAuth()
  const { data: lists = [] } = useLists()
  const { data: tasks = [] } = useAllTasks()
  const [draft, setDraft] = useState('')
  const { pinned, togglePinned } = usePanelWindow()

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

        <div className="flex shrink-0 items-center">
          <button
            onClick={togglePinned}
            className={clsx('btn-ghost px-2', pinned && 'text-accent-600')}
            aria-label={pinned ? 'Panel lösen' : 'Panel anheften'}
            aria-pressed={pinned}
            title={
              pinned
                ? 'Angeheftet — bleibt offen. Klicken zum Lösen.'
                : 'Anheften — bleibt offen, statt beim Klick daneben zu schließen'
            }
          >
            {pinned ? <Pin size={16} /> : <PinOff size={16} />}
          </button>

          <button
            onClick={() => void openMainWindow()}
            className="btn-ghost px-2"
            aria-label="Im Hauptfenster öffnen"
            title="Im Hauptfenster öffnen"
          >
            <ArrowUpRight size={16} />
          </button>

          {/* Nur angeheftet: unangeheftet schließt schon der Klick daneben,
              und ein Knopf, der dasselbe tut, ist nur ein Knopf mehr. */}
          {pinned && (
            <button
              onClick={() => void hidePanel()}
              className="btn-ghost px-2"
              aria-label="Panel schließen"
              title="Schließen — das Tray-Symbol holt es zurück"
            >
              <X size={16} />
            </button>
          )}
        </div>
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
 * Alles, was das Panel als *Fenster* betrifft: anheften, Position merken,
 * beim Aufklappen nachladen.
 *
 * Der Nachladeteil ist der unscheinbarste und der wichtigste. Das Panel-Fenster
 * wird nie zerstört, sondern nur versteckt — React montiert also nicht neu, und
 * `refetchOnWindowFocus` greift nicht zuverlässig, weil ein verstecktes Fenster
 * den Fokus nie richtig verliert. Ohne das Signal aus Rust zeigte das Panel
 * beim nächsten Aufklappen den Stand von vorhin.
 */
function usePanelWindow() {
  const queryClient = useQueryClient()
  const [pinned, setPinned] = useState(isPanelPinned)

  // Beim Start meldet das Panel den gemerkten Zustand einmal nach Rust. Rust
  // startet immer ungeheftet - dort überlebt nichts einen Neustart.
  useEffect(() => {
    if (isPanelPinned()) void setPanelPinned(true)
  }, [])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false

    // Die Anmeldung ist asynchron; wird die Komponente vorher abgeräumt, muss
    // die zurückkommende Abmeldefunktion trotzdem laufen.
    void watchPanelPosition().then((fn) => (cancelled ? fn() : (dispose = fn)))

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false

    void onPanelShown(() => {
      void queryClient.invalidateQueries({ queryKey: qk.lists })
      void queryClient.invalidateQueries({ queryKey: qk.allTasks })
    }).then((fn) => (cancelled ? fn() : (dispose = fn)))

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [queryClient])

  const togglePinned = () => {
    const next = !pinned
    setPinned(next)
    void setPanelPinned(next)
  }

  return { pinned, togglePinned }
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
