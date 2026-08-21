import { Fragment, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  useCreateTask,
  useDeleteTask,
  useTasks,
  useToggleTaskDone,
  useUpdateTask,
} from '@/data/hooks'
import { buildTaskTree, flattenTree, subtreeIds } from '@/data/tree'
import type { Task, TaskNode } from '@/data/types'
import { keyAtEnd, keyBetween, keyForIndex, sortByPosition } from '@/lib/ordering'
import { isTouchPrimary } from '@/lib/platform'
import { QuickAdd } from './QuickAdd'
import { TaskActionSheet, type TaskAbilities } from './TaskActionSheet'
import { TaskDetails } from './TaskDetails'
import { TaskRow, type TaskRowActions } from './TaskRow'

/**
 * Aufgabenansicht einer Liste.
 *
 * Die gesamte Baumlogik (einruecken, ausruecken, Geschwister anlegen) sitzt
 * hier und arbeitet auf der flachen Task-Liste. Die Zeilenkomponente kennt
 * nur ihren Knoten und die Callbacks - dadurch bleibt sie testbar und
 * wiederverwendbar.
 */
export function TaskView({ listId, accent }: { listId: string; accent: string }) {
  const { data: tasks = [], isLoading } = useTasks(listId)
  const createTask = useCreateTask(listId)
  const updateTask = useUpdateTask(listId)
  const deleteTask = useDeleteTask(listId)
  const toggleDone = useToggleTaskDone(listId)

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [showDone, setShowDone] = useState(false)
  const [detailsFor, setDetailsFor] = useState<string | null>(null)

  // Nur die Kennung, nicht der Knoten selbst. Der Knoten unten wird bei jedem
  // Rendern frisch herausgesucht - sonst zeigte das Blatt nach dem ersten
  // Verschieben noch den Stand von davor und liesse "nach oben" anbieten,
  // obwohl die Aufgabe schon oben steht.
  const [actionsFor, setActionsFor] = useState<string | null>(null)

  const doneCount = tasks.filter((t) => t.done).length

  const visible = useMemo(
    () => (showDone ? tasks : hideCompletedSubtrees(tasks)),
    [tasks, showDone],
  )
  const tree = useMemo(() => buildTaskTree(visible), [visible])
  const rows = useMemo(
    () => flattenTree(tree, (id) => collapsed.has(id)),
    [tree, collapsed],
  )

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const expand = (id: string) =>
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  /**
   * Geschwister eines Knotens, nach position sortiert.
   *
   * Zwei Varianten, und der Unterschied ist wichtig:
   *
   * - `allSiblingsOf` sieht ALLE Aufgaben. Nur damit stimmt die Positions-
   *   rechnung, sonst landet eine neue Aufgabe auf demselben Schlüssel wie
   *   eine gerade ausgeblendete.
   * - `visibleSiblingsOf` sieht nur, was auch auf dem Bildschirm steht. Nur
   *   damit wählen Tastaturbefehle einen Nachbarn, den man auch sieht.
   *
   * Verwechselt man die beiden, rückt Tab eine Aufgabe unter eine
   * ausgeblendete erledigte Aufgabe ein - und sie verschwindet spurlos,
   * weil erledigte Teilbäume mit ausgeblendet werden.
   */
  const allSiblingsOf = (parentId: string | null): Task[] =>
    sortByPosition(tasks.filter((t) => t.parentId === parentId))

  const visibleSiblingsOf = (parentId: string | null): Task[] =>
    sortByPosition(visible.filter((t) => t.parentId === parentId))

  const actions: TaskRowActions = {
    onToggleDone: (node) => {
      // Nicht updateTask: bei wiederkehrenden Aufgaben muss zusaetzlich die
      // naechste Faelligkeit entstehen (siehe data/recurrence.ts).
      toggleDone.mutate(node)
    },

    onRename: (node, title) => {
      updateTask.mutate({ id: node.id, patch: { title } })
    },

    onDelete: (node) => {
      deleteTask.mutate(node.id)
      setCollapsed((prev) => {
        const next = new Set(prev)
        for (const id of subtreeIds(node)) next.delete(id)
        return next
      })
    },

    onAddSubtask: (node) => {
      expand(node.id)
      createTask.mutate({
        title: '',
        parentId: node.id,
        position: keyAtEnd(allSiblingsOf(node.id)),
      })
    },

    onCreateSibling: (node) => {
      // Position aus der vollstaendigen Reihenfolge: die neue Aufgabe soll
      // direkt hinter dieser hier stehen, egal was dazwischen ausgeblendet ist.
      const siblings = allSiblingsOf(node.parentId)
      const index = siblings.findIndex((t) => t.id === node.id)
      const next = siblings[index + 1]
      createTask.mutate({
        title: '',
        parentId: node.parentId,
        position: keyBetween(node.position, next?.position ?? null),
      })
    },

    // Tab: der vorherige SICHTBARE Geschwisterknoten wird zum Elternteil.
    onIndent: (node) => {
      const siblings = visibleSiblingsOf(node.parentId)
      const index = siblings.findIndex((t) => t.id === node.id)
      const newParent = siblings[index - 1]
      if (!newParent) return // erster Knoten hat niemanden ueber sich

      expand(newParent.id)
      updateTask.mutate({
        id: node.id,
        patch: {
          parentId: newParent.id,
          position: keyAtEnd(allSiblingsOf(newParent.id)),
        },
      })
    },

    // Shift+Tab: eine Ebene hoch, direkt hinter das bisherige Elternteil.
    onOutdent: (node) => {
      if (!node.parentId) return
      const parent = tasks.find((t) => t.id === node.parentId)
      if (!parent) return

      const parentSiblings = allSiblingsOf(parent.parentId)
      const parentIndex = parentSiblings.findIndex((t) => t.id === parent.id)
      const afterParent = parentSiblings[parentIndex + 1]

      updateTask.mutate({
        id: node.id,
        patch: {
          parentId: parent.parentId,
          position: keyBetween(parent.position, afterParent?.position ?? null),
        },
      })
    },

    onSetDue: (node, dueAt) => {
      updateTask.mutate({ id: node.id, patch: { dueAt } })
    },

    onCyclePriority: (node) => {
      const next = ((node.priority ?? 0) + 1) % 4
      updateTask.mutate({ id: node.id, patch: { priority: next === 0 ? null : next } })
    },

    onToggleDetails: (node) => {
      setDetailsFor((current) => (current === node.id ? null : node.id))
    },

    onOpenActions: (node) => {
      setActionsFor(node.id)
    },

    onMove: (node, direction) => {
      // Verschoben wird innerhalb der SICHTBAREN Geschwister, gerechnet wird
      // gegen alle - sonst springt die Zeile ueber eine ausgeblendete hinweg
      // und landet gefuehlt an der falschen Stelle.
      const visibleSiblings = visibleSiblingsOf(node.parentId)
      const from = visibleSiblings.findIndex((t) => t.id === node.id)
      const to = from + direction
      if (from < 0 || to < 0 || to >= visibleSiblings.length) return

      const anchor = visibleSiblings[to]
      if (!anchor) return

      const all = allSiblingsOf(node.parentId)
      const targetIndex = all.findIndex((t) => t.id === anchor.id)

      updateTask.mutate({
        id: node.id,
        patch: {
          position: keyForIndex(
            all,
            direction === 1 ? targetIndex + 1 : targetIndex,
            node.id,
          ),
        },
      })
    },
  }

  // Die offene Zeile des Aktionsblatts, bei jedem Rendern neu gesucht. Ist sie
  // verschwunden - geloescht, oder unter einem zugeklappten Elternteil - gibt
  // es nichts mehr anzubieten, und das Blatt schliesst sich von selbst.
  const actionsNode = actionsFor ? (rows.find((row) => row.id === actionsFor) ?? null) : null

  /**
   * Was mit dieser Zeile gerade geht.
   *
   * Gerechnet wird gegen die SICHTBAREN Geschwister, aus demselben Grund wie
   * bei den Tastaturbefehlen weiter oben: Ein "nach oben", das die Aufgabe
   * hinter eine ausgeblendete erledigte schiebt, sieht aus, als sei nichts
   * passiert.
   */
  const abilitiesOf = (node: TaskNode): TaskAbilities => {
    const siblings = visibleSiblingsOf(node.parentId)
    const index = siblings.findIndex((task) => task.id === node.id)

    return {
      // Einruecken heisst: unter den Vorgaenger. Ohne Vorgaenger geht es nicht.
      indent: index > 0,
      outdent: node.parentId !== null,
      up: index > 0,
      down: index >= 0 && index < siblings.length - 1,
    }
  }

  return (
    <div className="flex flex-col">
      {isLoading && <p className="px-2 py-6 text-sm text-muted">Lädt …</p>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-[var(--radius-card)] border-2 border-dashed border-subtle px-4 py-12 text-center">
          <p className="text-sm text-muted">
            {doneCount > 0 ? 'Alles erledigt.' : 'Noch nichts hier.'}
          </p>
          {/* Einem Telefon von Tab und Alt+Pfeil zu erzählen, hilft niemandem.
              Dort führt derselbe Weg über das Aktionsblatt der Zeile. */}
          <p className="mt-1.5 text-xs text-muted">
            {isTouchPrimary
              ? 'Über ⋯ am Zeilenende gibt es Unterpunkte, Fälligkeit, Priorität und die Reihenfolge.'
              : 'Tab rückt ein, Shift+Tab wieder aus, Enter legt die nächste Aufgabe an, Alt+↑/↓ verschiebt.'}
          </p>
        </div>
      )}

      {/*
        Auf dem Telefon randlos, auf dem Schreibtisch in einer Karte.

        Das ist keine Unentschlossenheit, sondern der Unterschied zwischen den
        Geräten. Auf einem Telefon füllt eine Ansicht den ganzen Schirm — eine
        Karte darin grenzt nichts ab, sie fügt nur einen Rahmen hinzu, den man
        nicht braucht. Auf einem breiten Fenster steht die Spalte dagegen
        mitten in einer leeren Fläche, und ohne Karte weiß das Auge nicht, wo
        der Inhalt anfängt.

        Genau diese Unterscheidung hatte ich zuerst vergessen: Ich hatte die
        Karte überall entfernt, weil sie auf dem Telefon störte.
      */}
      {rows.length > 0 && (
        <div className="divide-y divide-ink/8 md:card md:divide-subtle md:px-3 md:py-1">
          {rows.map((node) => (
            <Fragment key={node.id}>
              <TaskRow
                node={node}
                collapsed={collapsed.has(node.id)}
                onToggleCollapse={() => toggleCollapse(node.id)}
                actions={actions}
                accent={accent}
                detailsOpen={detailsFor === node.id}
                autoFocus={node.title === ''}
              />
              {detailsFor === node.id && (
                <TaskDetails
                  task={node}
                  depth={node.depth}
                  onPatch={(patch) => updateTask.mutate({ id: node.id, patch })}
                  onClose={() => setDetailsFor(null)}
                />
              )}
            </Fragment>
          ))}
        </div>
      )}

      {doneCount > 0 && (
        <button
          onClick={() => setShowDone((v) => !v)}
          className={clsx(
            'mt-4 self-start rounded-lg px-3 py-1.5 text-xs font-medium text-muted',
            'transition-colors hover:bg-hover hover:text-ink',
          )}
        >
          {showDone
            ? `${doneCount} erledigte ausblenden`
            : `${doneCount} erledigte einblenden`}
        </button>
      )}

      {/*
        Die Eingabe klebt am unteren Rand des Scrollbereichs statt über der
        Liste zu stehen.

        Auf dem Telefon ist das der Unterschied zwischen Daumen und Umgreifen:
        Sie sitzt dort, wo gleich die Tastatur aufgeht, und nicht am anderen
        Ende des Geräts. Auf dem Desktop stört es nicht — dort ist der Weg
        dorthin ohnehin gleich weit.

        Der Farbverlauf nach oben ist kein Schmuck: Ohne ihn schneidet die
        Kante der Eingabefläche mitten durch die Zeile, die gerade darunter
        durchscrollt.
      */}
      <div className="sticky bottom-0 z-10 -mx-5 mt-4 bg-gradient-to-t from-app from-70% to-transparent px-5 pb-2 pt-6 sm:-mx-8 sm:px-8">
        <QuickAdd
          accent={accent}
          onSubmit={(task) =>
            createTask.mutate({ ...task, position: keyAtEnd(allSiblingsOf(null)) })
          }
        />
      </div>

      {actionsNode && (
        <TaskActionSheet
          node={actionsNode}
          abilities={abilitiesOf(actionsNode)}
          detailsOpen={detailsFor === actionsNode.id}
          actions={actions}
          onClose={() => setActionsFor(null)}
        />
      )}
    </div>
  )
}

/**
 * Entfernt erledigte Aufgaben samt ihrer Unterpunkte.
 *
 * Wichtig ist das "samt Unterpunkte": filtert man nur die erledigten Zeilen
 * heraus, verlieren deren Kinder ihr Elternteil und tauchen als vermeintliche
 * Hauptaufgaben ganz oben wieder auf.
 */
function hideCompletedSubtrees(tasks: readonly Task[]): Task[] {
  const hidden = new Set(tasks.filter((t) => t.done).map((t) => t.id))

  let grew = true
  while (grew) {
    grew = false
    for (const task of tasks) {
      if (task.parentId && hidden.has(task.parentId) && !hidden.has(task.id)) {
        hidden.add(task.id)
        grew = true
      }
    }
  }

  return tasks.filter((t) => !hidden.has(t.id))
}
