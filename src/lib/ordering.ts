import { generateKeyBetween } from 'fractional-indexing'

/**
 * Sortierung per Fractional Index.
 *
 * Statt einer Integer-Spalte, bei der jedes Verschieben alle Geschwister
 * umnummeriert, bekommt jede Zeile einen String-Schluessel. Zwischen zwei
 * beliebige Schluessel laesst sich immer ein neuer legen ('a0' < 'a0V' < 'a1').
 *
 * Der Gewinn zeigt sich erst bei geteilten Listen: verschieben zwei Leute
 * gleichzeitig etwas, schreibt jeder genau eine Zeile. Mit Integer-Positionen
 * schreiben beide alle Zeilen - und ueberschreiben sich gegenseitig.
 */

export interface Positioned {
  position: string
}

/** Aufsteigend nach position; bei Gleichstand stabil ueber die id. */
export function sortByPosition<T extends Positioned & { id: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => a.position.localeCompare(b.position) || a.id.localeCompare(b.id),
  )
}

/** Schluessel zwischen zwei Nachbarn. null steht fuer "Anfang"/"Ende". */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after)
}

/** Neuer Schluessel hinter allen vorhandenen Eintraegen. */
export function keyAtEnd(items: readonly Positioned[]): string {
  const last = maxPosition(items)
  return generateKeyBetween(last, null)
}

/** Neuer Schluessel vor allen vorhandenen Eintraegen. */
export function keyAtStart(items: readonly Positioned[]): string {
  const first = minPosition(items)
  return generateKeyBetween(null, first)
}

/**
 * Schluessel, um `moved` an Index `targetIndex` der (bereits sortierten)
 * Geschwisterliste einzufuegen. `siblings` darf das verschobene Element
 * enthalten - es wird vorher herausgefiltert, sonst wuerde es als eigener
 * Nachbar zaehlen und man bekaeme denselben Schluessel zurueck.
 */
export function keyForIndex<T extends Positioned & { id: string }>(
  siblings: readonly T[],
  targetIndex: number,
  movedId?: string,
): string {
  const others = sortByPosition(
    movedId ? siblings.filter((s) => s.id !== movedId) : siblings,
  )
  const clamped = Math.max(0, Math.min(targetIndex, others.length))
  const before = clamped > 0 ? (others[clamped - 1]?.position ?? null) : null
  const after = clamped < others.length ? (others[clamped]?.position ?? null) : null
  return generateKeyBetween(before, after)
}

function maxPosition(items: readonly Positioned[]): string | null {
  let max: string | null = null
  for (const item of items) {
    if (max === null || item.position.localeCompare(max) > 0) max = item.position
  }
  return max
}

function minPosition(items: readonly Positioned[]): string | null {
  let min: string | null = null
  for (const item of items) {
    if (min === null || item.position.localeCompare(min) < 0) min = item.position
  }
  return min
}
