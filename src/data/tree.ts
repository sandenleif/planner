import { sortByPosition } from '@/lib/ordering'
import type { Task, TaskNode } from './types'

/**
 * Aus der flachen Task-Liste den Unterpunkt-Baum bauen.
 *
 * In der Datenbank steht nur parent_id (Adjazenzliste). Das ist die
 * langweiligste und robusteste Variante: ein Feld, keine Redundanz, ein
 * Verschieben aendert genau eine Zeile. Der Baum entsteht hier im Client -
 * bei den Datenmengen einer To-do-App ist das Mikrosekundenarbeit.
 */
export function buildTaskTree(tasks: readonly Task[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>()
  for (const task of tasks) {
    nodes.set(task.id, { ...task, children: [], depth: 0 })
  }

  const roots: TaskNode[] = []

  for (const node of nodes.values()) {
    // Zeigt parentId ins Leere (Elternteil geloescht oder nicht geladen),
    // behandeln wir den Knoten als Wurzel - sonst verschwindet er lautlos.
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sortRecursive = (list: TaskNode[], depth: number): TaskNode[] => {
    const sorted = sortByPosition(list)
    for (const node of sorted) {
      node.depth = depth
      node.children = sortRecursive(node.children, depth + 1)
    }
    return sorted
  }

  return sortRecursive(roots, 0)
}

/** Baum -> flache Liste in Anzeigereihenfolge (Tiefensuche). */
export function flattenTree(
  nodes: readonly TaskNode[],
  isCollapsed?: (id: string) => boolean,
): TaskNode[] {
  const out: TaskNode[] = []
  const walk = (list: readonly TaskNode[]) => {
    for (const node of list) {
      out.push(node)
      if (!isCollapsed?.(node.id)) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** Erledigt/gesamt ueber den ganzen Teilbaum, den Knoten selbst ausgenommen. */
export function subtreeProgress(node: TaskNode): { done: number; total: number } {
  let done = 0
  let total = 0
  const walk = (list: readonly TaskNode[]) => {
    for (const child of list) {
      total++
      if (child.done) done++
      walk(child.children)
    }
  }
  walk(node.children)
  return { done, total }
}

/** Alle IDs eines Teilbaums inklusive Wurzel - fuer Loeschen und Verschieben. */
export function subtreeIds(node: TaskNode): string[] {
  const ids: string[] = []
  const walk = (n: TaskNode) => {
    ids.push(n.id)
    n.children.forEach(walk)
  }
  walk(node)
  return ids
}
