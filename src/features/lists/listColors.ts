/**
 * Farbpalette der Listen.
 *
 * Alle Toene sind dunkel genug, dass weisse Schrift darauf sicher lesbar ist
 * (Kontrast >= 4.5:1) - deshalb keine hellen Pastelltoene.
 *
 * Frueher lagen sie alle im Gruen-Blau-Bereich, mit der Begruendung, dass ein
 * einzelnes Rot oder Orange auf der Startseite alle Aufmerksamkeit an sich
 * zieht. Die Absicht war richtig, die Folge nicht: Waldgruen, Salbei und Olive
 * liessen sich als sieben Pixel grosser Punkt nicht auseinanderhalten. Eine
 * Farbkennung, die man nicht unterscheidet, ist keine Kennung, sondern Zierde.
 *
 * Jetzt verteilen sich sieben Toene ueber den ganzen Farbkreis. Sie sind
 * bewusst nicht voll gesaettigt - nebeneinander auf der Uebersicht sollen sie
 * ruhig wirken, aber unterscheidbar bleiben.
 *
 * Kein Rot darunter, und das ist der Grund fuer Rose statt Rot: Rot bedeutet
 * in dieser App ausschliesslich "ueberfaellig". Eine Liste, die rot ist, sieht
 * dauerhaft nach Alarm aus.
 */
export const LIST_COLORS = [
  { value: '#3B5BDB', name: 'Indigo' },
  { value: '#0C8599', name: 'Türkis' },
  { value: '#2F9E44', name: 'Grün' },
  { value: '#B57314', name: 'Bernstein' },
  { value: '#C2255C', name: 'Rose' },
  { value: '#7048E8', name: 'Violett' },
  { value: '#4A5568', name: 'Schiefer' },
] as const

export const DEFAULT_LIST_COLOR = LIST_COLORS[0].value

/** Fallback, damit eine Liste ohne gesetzte Farbe nicht grau erscheint. */
export function listColor(color: string | null | undefined): string {
  return color ?? DEFAULT_LIST_COLOR
}
