import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthProvider'
import {
  qk,
  useAllTasks,
  useCreateTask,
  useDeleteTask,
  useGlobalRealtime,
  useLists,
  useToggleTaskDone,
  useUpdateTask,
} from '@/data/hooks'
import type { List, Task } from '@/data/types'
import { buildTaskTree, flattenTree } from '@/data/tree'
import { isOverdue, todayIso } from '@/lib/date'
import { sortByPosition } from '@/lib/ordering'
import { listColor } from '@/features/lists/listColors'
import { DueBadge } from '@/features/tasks/DueBadge'
import { parseQuickAdd } from '@/lib/parseQuickAdd'
import {
  hidePanel,
  isPanelPinned,
  onPanelHiding,
  onPanelShown,
  openMainWindow,
  setPanelPinned,
  watchPanelPosition,
} from '@/lib/desktop'
import { Toaster } from '@/ui/Toaster'

/**
 * Die Menüleisten-Ansicht: das, was aus dem Tray-Symbol aufklappt.
 *
 * Bewusst eine eigene Route und kein verkleinertes Hauptfenster. Das Panel
 * beantwortet eine Frage — was steht an — und lässt die Handgriffe zu, die
 * daraus folgen: abhaken, umbenennen, Fälligkeit schieben, Priorität setzen,
 * löschen, etwas Neues notieren. Dafür soll niemand das Hauptfenster öffnen
 * müssen.
 *
 * Es gibt genau **eine** Ebene tiefer: von der Übersicht in eine Liste und
 * mit dem Pfeil zurück. Das ist kein Widerspruch zum alten Grundsatz „ein
 * Panel, aus dem man herausnavigiert, ist ein Fenster mit falschem Rahmen" —
 * hier navigiert man nicht heraus, sondern innerhalb. Was darüber hinausgeht,
 * führt weiter über einen Knopf ins Hauptfenster: Listen anlegen und
 * umsortieren, Unterpunkte umhängen, teilen, exportieren.
 *
 * Angeheftet (Stecknadel oben rechts) bleibt dasselbe Fenster stehen, statt
 * beim Klick daneben zu verschwinden. Das ist der Widget-Modus: dieselbe
 * Ansicht, nur dauerhaft auf dem Schreibtisch statt kurz aufgeklappt.
 */

/** Übersicht oder eine einzelne Liste — mehr Ebenen gibt es nicht. */
type PanelView = { kind: 'today' } | { kind: 'list'; listId: string }

export function PanelPage() {
  const auth = useAuth()
  const { data: lists = [] } = useLists()
  const { data: tasks = [] } = useAllTasks()

  const [draft, setDraft] = useState('')
  const [view, setView] = useState<PanelView>({ kind: 'today' })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { pinned, togglePinned, surfaceRef } = usePanelWindow()

  // Eigenes Fenster, eigene WebView, eigener Query-Cache - also auch ein
  // eigenes Abo. Ohne das sähe das Panel Fremdänderungen erst beim
  // Aufklappen, und angeheftet gar nicht.
  useGlobalRealtime()

  const today = todayIso()
  const sortedLists = useMemo(() => sortByPosition(lists), [lists])
  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists])

  const activeList = view.kind === 'list' ? listById.get(view.listId) : undefined

  // Die Liste ist weg - gelöscht, oder die Freigabe wurde entzogen. Die
  // Abfrage auf `lists.length` verhindert, dass das schon beim ersten Rendern
  // zuschlägt, wenn die Listen noch gar nicht geladen sind.
  if (view.kind === 'list' && !activeList && lists.length > 0) {
    setView({ kind: 'today' })
  }

  // Wohin die Schnellerfassung schreibt: in der Listenansicht in genau diese
  // Liste, in der Übersicht in die erste - sofern der Text nicht per #name
  // etwas anderes sagt.
  const parsed = parseQuickAdd(draft)
  const hintedList = parsed.listHint
    ? sortedLists.find((l) =>
        l.name.toLowerCase().startsWith(parsed.listHint!.toLowerCase()),
      )
    : undefined
  const targetList = activeList ?? hintedList ?? sortedLists[0]

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

  // Die Zeilen der Listenansicht. Der Baum entsteht aus `allTasks` statt aus
  // einer eigenen Abfrage: die Daten sind längst da, und eine zweite Abfrage
  // hieße einen Ladebalken für etwas, das schon im Cache liegt.
  const listRows = useMemo(() => {
    if (!activeList) return []
    const own = tasks.filter((t) => t.listId === activeList.id && !t.done)
    return flattenTree(buildTaskTree(own))
  }, [tasks, activeList])

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
    return (
      <div ref={surfaceRef} className="panel-surface">
        <PanelSignedOut loading={auth.loading} />
      </div>
    )
  }

  return (
    <div ref={surfaceRef} className="panel-surface flex flex-col">
      <header
        className="flex shrink-0 items-start justify-between gap-2 px-4 pb-2 pt-3.5"
        data-tauri-drag-region
      >
        <div className="flex min-w-0 items-center gap-2">
          {activeList && (
            <button
              onClick={() => {
                setView({ kind: 'today' })
                setExpandedId(null)
              }}
              className="btn-ghost -ml-2 shrink-0 px-2"
              aria-label="Zurück zur Übersicht"
              title="Zurück zur Übersicht"
            >
              <ArrowLeft size={16} />
            </button>
          )}

          <div className="min-w-0">
            <p className="truncate text-[11px] text-muted">
              {activeList
                ? `${listRows.length} offen`
                : new Intl.DateTimeFormat('de-DE', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  }).format(new Date())}
            </p>
            <h1 className="truncate text-base font-semibold">
              {activeList
                ? activeList.name
                : dueToday.length === 0
                  ? 'Nichts fällig'
                  : `${dueToday.length} ${dueToday.length === 1 ? 'Aufgabe' : 'Aufgaben'} heute`}
            </h1>
          </div>
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
            onClick={() =>
              void openMainWindow(activeList ? `/list/${activeList.id}` : undefined)
            }
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
        {activeList ? (
          listRows.length > 0 ? (
            <ul className="flex flex-col">
              {listRows.map((node) => (
                <PanelTaskRow
                  key={node.id}
                  task={node}
                  list={activeList}
                  depth={node.depth}
                  expanded={expandedId === node.id}
                  onToggleExpanded={() =>
                    setExpandedId((id) => (id === node.id ? null : node.id))
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-xs text-muted">
              Alles erledigt. Oben notieren legt hier etwas Neues an.
            </p>
          )
        ) : (
          <>
            {dueToday.length > 0 && (
              <ul className="mb-3 flex flex-col">
                {dueToday.map((task) => (
                  <PanelTaskRow
                    key={task.id}
                    task={task}
                    list={listById.get(task.listId)}
                    depth={0}
                    expanded={expandedId === task.id}
                    onToggleExpanded={() =>
                      setExpandedId((id) => (id === task.id ? null : task.id))
                    }
                  />
                ))}
              </ul>
            )}

            {/* Statt einer Ueberschrift „LISTEN" nur eine Haarlinie: dass
                farbige Kacheln mit Zahlen Listen sind, muss niemandem gesagt
                werden, und Versalien in Kleinstschrift sind die Sorte
                Beschriftung, die jede Oberflaeche gleich aussehen laesst. */}
            <div className="mb-2.5 mt-1 h-px bg-subtle" />

            <div className="grid grid-cols-2 gap-2">
              {sortedLists.map((list) => (
                <button
                  key={list.id}
                  onClick={() => {
                    setView({ kind: 'list', listId: list.id })
                    setExpandedId(null)
                  }}
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
          </>
        )}
      </div>

      {/* Auch das Panel braucht Kurzmeldungen: ohne sie liefe "Gelöscht —
          Rückgängig" ins Leere, und Löschen ohne Rückweg ist in einem Popover,
          das man mit einem Klick daneben schließt, keine gute Idee. */}
      <Toaster />
    </div>
  )
}

/** 0 = keine. Die Farben entsprechen denen im Hauptfenster. */
const PRIORITIES: { value: number; label: string; title: string; className: string }[] = [
  { value: 0, label: '–', title: 'Keine Priorität', className: 'text-muted' },
  { value: 1, label: '!', title: 'Niedrig', className: 'text-sky-600' },
  { value: 2, label: '!!', title: 'Mittel', className: 'text-amber-600' },
  { value: 3, label: '!!!', title: 'Hoch', className: 'text-red-600' },
]

/**
 * Eine Aufgabenzeile im Panel, aufklappbar.
 *
 * Zugeklappt ist sie das, was sie vorher war: Haken, Titel, Fälligkeit,
 * Listenpunkt. Aufgeklappt kommen Titel-Feld, Priorität und Löschen dazu —
 * genug, um eine Aufgabe zu Ende zu bearbeiten, ohne dass aus dem Panel eine
 * zweite, schlechtere Detailansicht wird. Notizen und Wiederholung bleiben
 * bewusst draußen: dafür ist ein 380 Pixel breites Popover der falsche Ort,
 * und beides ändert man selten im Vorbeigehen.
 */
function PanelTaskRow({
  task,
  list,
  depth,
  expanded,
  onToggleExpanded,
}: {
  task: Task
  list: List | undefined
  depth: number
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const toggleDone = useToggleTaskDone(task.listId)
  const updateTask = useUpdateTask(task.listId)
  const deleteTask = useDeleteTask(task.listId)

  const accent = listColor(list?.color)
  const overdue = isOverdue(task.dueAt)

  const [title, setTitle] = useState(task.title)
  const [syncedTitle, setSyncedTitle] = useState(task.title)

  // Entwurf nachziehen, wenn der Titel von außen kommt - anderes Gerät, oder
  // die echte Zeile ersetzt gerade den optimistischen Platzhalter. Bewusst
  // während des Renders und nicht in einem Effekt: der liefe erst nach dem
  // Zeichnen, und für einen Wimpernschlag stünde der alte Titel im Feld.
  if (task.title !== syncedTitle) {
    setSyncedTitle(task.title)
    setTitle(task.title)
  }

  const commitTitle = () => {
    const next = title.trim()
    if (!next) {
      setTitle(task.title)
      return
    }
    if (next === task.title) return
    updateTask.mutate({ id: task.id, patch: { title: next } })
  }

  return (
    <li
      className="flex flex-col"
      style={{ paddingLeft: depth > 0 ? `${Math.min(depth, 3) * 12}px` : undefined }}
    >
      <div className="group -mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-hover">
        <button
          onClick={() => toggleDone.mutate(task)}
          className="flex size-[17px] shrink-0 items-center justify-center rounded-md border-2 border-muted/45 transition-colors hover:border-current"
          style={{ color: accent }}
          aria-label={`„${task.title}“ als erledigt markieren`}
        >
          <Check size={11} strokeWidth={3.5} className="opacity-0 group-hover:opacity-40" />
        </button>

        <button
          onClick={onToggleExpanded}
          className="min-w-0 flex-1 truncate text-left text-[13px]"
          aria-expanded={expanded}
          title="Bearbeiten"
        >
          {task.title}
        </button>

        {!expanded && task.dueAt && overdue && (
          <span className="shrink-0 text-[10px] font-medium text-red-600">überfällig</span>
        )}

        {!expanded && list && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
            title={list.name}
          />
        )}

        <ChevronDown
          size={13}
          className={clsx(
            'shrink-0 text-muted transition-transform',
            expanded ? 'rotate-180' : 'opacity-0 group-hover:opacity-60',
          )}
        />
      </div>

      {expanded && (
        <div className="mb-1.5 flex flex-col gap-2 rounded-lg border border-subtle bg-panel p-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitTitle()
                onToggleExpanded()
              }
              if (e.key === 'Escape') {
                setTitle(task.title)
                onToggleExpanded()
              }
            }}
            className="w-full rounded-md border border-subtle bg-app px-2 py-1.5 text-[13px] outline-none focus:border-accent-500"
            aria-label="Titel"
          />

          <div className="flex items-center justify-between gap-2">
            <DueBadge
              dueAt={task.dueAt}
              allDay={task.allDay}
              done={task.done}
              onChange={(dueAt) => updateTask.mutate({ id: task.id, patch: { dueAt } })}
            />

            <div className="flex items-center gap-0.5">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority.value}
                  onClick={() =>
                    updateTask.mutate({
                      id: task.id,
                      patch: { priority: priority.value },
                    })
                  }
                  className={clsx(
                    'rounded-md px-1.5 py-1 text-[11px] font-semibold transition-colors',
                    (task.priority ?? 0) === priority.value
                      ? `bg-sunken ${priority.className}`
                      : 'text-muted hover:bg-sunken',
                  )}
                  aria-label={priority.title}
                  aria-pressed={(task.priority ?? 0) === priority.value}
                  title={priority.title}
                >
                  {priority.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                onToggleExpanded()
                deleteTask.mutate(task.id)
              }}
              className="btn-ghost shrink-0 px-1.5 text-muted hover:text-red-600"
              aria-label="Löschen"
              title="Löschen — lässt sich zurückholen"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {list && (
            <p className="text-[10px] text-muted">
              in <span style={{ color: accent }}>{list.name}</span> · Notizen und
              Wiederholung im Hauptfenster
            </p>
          )}
        </div>
      )}
    </li>
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
  const surfaceRef = useRef<HTMLDivElement>(null)

  // Das Panel-Fenster ist randlos und transparent. Damit die runden Ecken
  // sichtbar werden, darf der Body keine Farbe malen — die Klasse schaltet das
  // in index.css um. Sie steht auf <html>, weil das Panel dieselbe index.html
  // lädt wie das Hauptfenster und die Regel nur hier gelten darf.
  useEffect(() => {
    document.documentElement.classList.add('is-panel')
    return () => document.documentElement.classList.remove('is-panel')
  }, [])

  /**
   * Ein- und Ausblenden.
   *
   * Über die Web Animations API statt über CSS-Klassen: Das Fenster wird nie
   * neu montiert, sondern nur gezeigt und versteckt. Eine CSS-Animation liefe
   * deshalb genau einmal und beim zweiten Aufklappen nie wieder — man müsste
   * sie über einen Umweg neu anstoßen. `element.animate()` startet dagegen bei
   * jedem Aufruf von vorn.
   */
  const play = useCallback((kind: 'in' | 'out') => {
    const element = surfaceRef.current
    if (!element) return

    // Wer „Bewegung reduzieren" eingestellt hat, bekommt das Panel ohne
    // Bewegung. Rust wartet trotzdem seine 135 ms ab - das ist unauffällig.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // Eine noch laufende Bewegung aus dem letzten Auf- oder Zuklappen würde
    // sonst mit fill: 'both' den Endzustand festhalten.
    for (const animation of element.getAnimations()) animation.cancel()

    if (kind === 'in') {
      element.animate(
        [
          { opacity: 0, transform: 'translateY(-8px) scale(0.96)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ],
        // Ease-out, das schnell anfängt und weich ausläuft - die Kurve, nach
        // der sich ein Popover anfühlt, statt einfach da zu sein.
        { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
      )
      return
    }

    element.animate(
      [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(-4px) scale(0.985)' },
      ],
      // Kürzer als das Einblenden: Zumachen soll sich entschieden anfühlen,
      // nicht zögerlich. Muss unter HIDE_DELAY in src-tauri/src/lib.rs bleiben.
      { duration: 120, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' },
    )
  }, [])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false

    void onPanelHiding(() => play('out')).then((fn) =>
      cancelled ? fn() : (dispose = fn),
    )

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [play])

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
      play('in')
      void queryClient.invalidateQueries({ queryKey: qk.lists })
      void queryClient.invalidateQueries({ queryKey: qk.allTasks })
    }).then((fn) => (cancelled ? fn() : (dispose = fn)))

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [queryClient, play])

  const togglePinned = () => {
    const next = !pinned
    setPinned(next)
    void setPanelPinned(next)
  }

  return { pinned, togglePinned, surfaceRef }
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
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
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
