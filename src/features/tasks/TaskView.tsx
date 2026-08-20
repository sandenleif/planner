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
import type { Task } from '@/data/types'
import { keyAtEnd, keyBetween, keyForIndex, sortByPosition } from '@/lib/ordering'
import { QuickAdd } from './QuickAdd'
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

  return (
    <div className="flex flex-col">
      <QuickAdd
        accent={accent}
        onSubmit={(task) =>
          createTask.mutate({ ...task, position: keyAtEnd(allSiblingsOf(null)) })
        }
      />

      {isLoading && <p className="px-2 py-6 text-sm text-muted">Lädt …</p>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-[var(--radius-card)] border-2 border-dashed border-subtle px-4 py-12 text-center">
          <p className="text-sm text-muted">
            {doneCount > 0 ? 'Alles erledigt.' : 'Noch nichts hier.'}
          </p>
          <p className="mt-1.5 text-xs text-muted">
            Tab rückt ein, Shift+Tab wieder aus, Enter legt die nächste Aufgabe an,
            Alt+↑/↓ verschiebt.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card px-2 py-2">
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
