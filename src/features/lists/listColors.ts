/**
 * Farbpalette der Listen-Kacheln.
 *
 * Alle Toene sind dunkel genug, dass weisse Schrift darauf sicher lesbar ist
 * (Kontrast >= 4.5:1) - deshalb keine hellen Pastelltoene. Und alle liegen im
 * Gruen-Blau-Bereich: ein einzelnes Rot oder Orange dazwischen zieht auf der
 * Startseite sofort alle Aufmerksamkeit auf sich, ohne dass die Liste
 * wichtiger waere.
 */
export const LIST_COLORS = [
  { value: '#2E6F50', name: 'Waldgrün' },
  { value: '#3F8B62', name: 'Salbei' },
  { value: '#177068', name: 'Petrol' },
  { value: '#2D6396', name: 'Tiefblau' },
  { value: '#4E7A34', name: 'Olive' },
  { value: '#55708F', name: 'Graublau' },
] as const

export const DEFAULT_LIST_COLOR = LIST_COLORS[0].value

/** Fallback, damit eine Liste ohne gesetzte Farbe nicht grau erscheint. */
export function listColor(color: string | null | undefined): string {
  return color ?? DEFAULT_LIST_COLOR
}
