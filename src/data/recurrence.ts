import type { NewTask, Recurrence, Task } from './types'

/**
 * Wiederkehrende Aufgaben.
 *
 * Modell: eine wiederkehrende Aufgabe wird beim Abhaken NICHT zurückgesetzt,
 * sondern bleibt erledigt - und daneben entsteht eine neue Aufgabe mit dem
 * nächsten Fälligkeitsdatum. Das kostet eine Zeile pro Durchgang, hat aber
 * zwei Vorteile, die den Speicherplatz wert sind:
 *
 *   * Die Historie bleibt erhalten ("wann habe ich das letzte Mal ...?").
 *   * Unterpunkte, Notizen und Prioritäten wandern sauber mit, statt dass
 *     ein zurückgesetzter Haken alte Unterpunkte wieder aufleben lässt.
 */

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  daily: 'Täglich',
  weekdays: 'Werktags',
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
  yearly: 'Jährlich',
}

export const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = (
  Object.keys(RECURRENCE_LABEL) as Recurrence[]
).map((value) => ({ value, label: RECURRENCE_LABEL[value] }))

/**
 * Nächster Fälligkeitszeitpunkt nach `from`.
 *
 * Springt so lange weiter, bis das Ergebnis in der Zukunft liegt. Ohne diese
 * Schleife bekäme man beim Abhaken einer drei Wochen liegengebliebenen
 * täglichen Aufgabe ein Datum, das schon wieder überfällig ist - und damit
 * sofort wieder eine rote Zeile.
 */
export function nextDueDate(
  dueAt: string,
  recurrence: Recurrence,
  now: Date = new Date(),
): string {
  const next = new Date(dueAt)
  // Obergrenze gegen Endlosschleifen bei absurd alten Daten.
  const limit = 1000

  for (let i = 0; i < limit; i++) {
    advance(next, recurrence)
    if (next.getTime() > now.getTime()) break
  }

  return next.toISOString()
}

function advance(date: Date, recurrence: Recurrence): void {
  switch (recurrence) {
    case 'daily':
      date.setDate(date.getDate() + 1)
      return

    case 'weekdays':
      // Vorwärts bis zum nächsten Montag–Freitag.
      do {
        date.setDate(date.getDate() + 1)
      } while (date.getDay() === 0 || date.getDay() === 6)
      return

    case 'weekly':
      date.setDate(date.getDate() + 7)
      return

    case 'monthly': {
      // setMonth(+1) macht aus dem 31. Januar den 3. März. Deshalb den Tag
      // merken und auf den letzten Tag des Zielmonats begrenzen.
      const day = date.getDate()
      date.setDate(1)
      date.setMonth(date.getMonth() + 1)
      date.setDate(Math.min(day, daysInMonth(date.getFullYear(), date.getMonth())))
      return
    }

    case 'yearly': {
      // Gleiche Falle am 29. Februar.
      const day = date.getDate()
      const month = date.getMonth()
      date.setFullYear(date.getFullYear() + 1, month, 1)
      date.setDate(Math.min(day, daysInMonth(date.getFullYear(), month)))
      return
    }
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Die Folgeaufgabe zu einer gerade abgehakten - oder null, wenn sich nichts
 * wiederholt.
 *
 * Unterpunkte werden bewusst NICHT mitkopiert: eine Kopie mit allen Kindern
 * müsste rekursiv angelegt werden und würde bei jedem Durchgang die Datenmenge
 * verdoppeln. Wiederkehrende Aufgaben sind in der Praxis einzelne Handgriffe.
 */
export function nextOccurrence(task: Task, now: Date = new Date()): NewTask | null {
  if (!task.recurrence) return null

  // Ohne Fälligkeit gäbe es nichts fortzuschreiben - dann ab jetzt rechnen.
  const base = task.dueAt ?? now.toISOString()

  return {
    listId: task.listId,
    parentId: task.parentId,
    title: task.title,
    notes: task.notes,
    dueAt: nextDueDate(base, task.recurrence, now),
    allDay: task.allDay,
    priority: task.priority,
    recurrence: task.recurrence,
  }
}
