/**
 * UUID-v4-Erzeugung mit Rueckfallebene.
 *
 * crypto.randomUUID() gibt es nur in einem "secure context". Auf Android
 * laedt die WebView im Dev-Modus aber ueber http://<lan-ip>:1420 - dort
 * fehlt die Funktion. Deshalb der Fallback ueber getRandomValues.
 *
 * IDs werden im Client vergeben, nicht in der Datenbank: nur so kann eine
 * optimistisch eingefuegte Aufgabe sofort gerendert werden und behaelt ihre
 * Identitaet, wenn der Server sie spaeter bestaetigt.
 */
export function newId(): string {
  const c = globalThis.crypto

  if (typeof c?.randomUUID === 'function') return c.randomUUID()

  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // Version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // Variante 10xx

  const hex: string[] = []
  for (const b of bytes) hex.push(b.toString(16).padStart(2, '0'))

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
