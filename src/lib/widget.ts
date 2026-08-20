import type { List, Task } from '@/data/types'
import { formatDueDate, isOverdue, todayIso } from './date'
import { listColor } from '@/features/lists/listColors'
import { isAndroid, isTauri } from './platform'

/**
 * Der Stand, den die glanceable Ansichten zeigen — Tray-Symbol auf dem
 * Desktop, Homescreen-Widget auf Android.
 *
 * Beide Ziele bekommen denselben Schnappschuss, obwohl das Tray-Symbol nur
 * die Zahl braucht. Das ist Absicht: die Frage „was steht heute an" darf es
 * nur einmal geben. Zwei Rechenwege, die dieselbe Zahl liefern sollen,
 * liefern irgendwann zwei Zahlen.
 *
 * Die Zeilen sind hier **fertig formatiert** und nicht als Rohdaten
 * unterwegs. Der Kotlin-Teil des Widgets müsste sonst deutsche Datumsnamen,
 * Zeitzonen und die Regel „überfällig ist alles vor jetzt" ein zweites Mal
 * kennen — in einer Sprache, in der niemand nachsieht, wenn sich die Regel
 * ändert. Das Widget bekommt Text und malt ihn hin.
 */

/** Mehr Zeilen zeigt kein Widget und kein Panel sinnvoll an. */
const MAX_LINES = 8

export interface WidgetTaskLine {
  id: string
  title: string
  /** Name der Liste — im Widget die kleine Beschriftung unter dem Titel. */
  listName: string
  /** '#RRGGBB'. Android kann damit direkt einen Punkt einfärben. */
  color: string
  /** Fertig formatiert: 'Heute 14:30', 'Gestern', '' bei ganztägig ohne Zeit. */
  due: string
  overdue: boolean
}

export interface WidgetSnapshot {
  /**
   * Wann der Stand entstanden ist, als Millisekunden seit 1970.
   *
   * Bewusst kein ISO-String: Android soll ohne `java.time` auskommen (das gibt
   * es erst ab API 26, die App laeuft ab 24) und ohne eigenen Parser fuer ein
   * Format, das es nur an dieser einen Stelle gaebe. Eine Zahl abzuziehen kann
   * jede Plattform.
   */
  generatedAtMs: number
  /** Offene Aufgaben, fällig bis einschließlich heute. */
  dueToday: number
  /** Davon bereits überfällig. */
  overdue: number
  /** Die ersten `MAX_LINES` davon, fällig zuerst. */
  tasks: WidgetTaskLine[]
}

export function buildWidgetSnapshot(tasks: Task[], lists: List[]): WidgetSnapshot {
  const listById = new Map(lists.map((list) => [list.id, list]))

  // Ende des heutigen Tages in LOKALER Zeit - nicht toISOString(). Sonst
  // wandert die Grenze mit der Zeitzone, und in Mitteleuropa faellt nach
  // Mitternacht der halbe naechste Tag mit in die Zahl.
  const limit = new Date(`${todayIso()}T23:59:59.999`).getTime()

  const due = tasks
    .filter((task) => !task.done && task.dueAt !== null && new Date(task.dueAt).getTime() <= limit)
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))

  return {
    generatedAtMs: Date.now(),
    dueToday: due.length,
    overdue: due.filter((task) => isOverdue(task.dueAt)).length,
    tasks: due.slice(0, MAX_LINES).map((task) => {
      const list = listById.get(task.listId)
      return {
        id: task.id,
        title: task.title,
        listName: list?.name ?? '',
        color: listColor(list?.color),
        due: task.dueAt ? formatDueDate(task.dueAt, task.allDay) : '',
        overdue: isOverdue(task.dueAt),
      }
    }),
  }
}

/**
 * Schickt den Stand dorthin, wo ihn die jeweilige Plattform anzeigt.
 *
 * Nur bei echter Änderung: `update_snapshot` stößt auf Android den
 * AppWidgetManager an, und jeder Anstoß zeichnet das Widget neu. Bei jedem
 * Tastendruck in der Schnellerfassung wäre das ein Flackern auf dem
 * Homescreen — sichtbar, obwohl die App im Vordergrund gar nicht zu sehen ist.
 */
let lastPublished = ''

/**
 * Die Sendungen laufen nacheinander, nicht nebeneinander.
 *
 * `invoke` ist asynchron; zwei Aufrufe kurz hintereinander könnten in
 * beliebiger Reihenfolge ankommen. Beim Abmelden ist genau das der Unterschied
 * zwischen einem geleerten Widget und einem, auf dem die Aufgabenliste des
 * vorherigen Kontos stehen bleibt.
 */
let queue: Promise<void> = Promise.resolve()

export function publishWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  // Im Browser gibt es weder Tray noch Homescreen-Widget.
  if (!isTauri) return Promise.resolve()

  // generatedAtMs bleibt bewusst draußen: sonst wäre jeder Schnappschuss neu.
  const fingerprint = JSON.stringify({ ...snapshot, generatedAtMs: 0 })
  if (fingerprint === lastPublished) return queue
  lastPublished = fingerprint

  queue = queue.then(() => send(snapshot))
  return queue
}

async function send(snapshot: WidgetSnapshot): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')

    if (isAndroid) {
      await invoke('plugin:planner-widget|update_snapshot', { payload: snapshot })
      return
    }

    // Desktop: das Tray-Symbol trägt nur die Zahl. Die Zeilen stehen im Panel,
    // das ohnehin dieselben Daten aus dem Query-Cache liest.
    await invoke('set_tray_badge', { count: snapshot.dueToday })
  } catch (error) {
    // Ein Widget, das den alten Stand zeigt, ist ein Schönheitsfehler. Eine
    // Fehlermeldung mitten in der Arbeit wäre schlimmer. Der Merker wird
    // zurückgesetzt, damit der nächste Versuch nicht als "schon gesendet"
    // durchfällt.
    console.warn('Widget-Stand nicht übermittelt:', error)
    lastPublished = ''
  }
}

/** Nach dem Abmelden: keine fremden Aufgabentitel auf dem Homescreen stehen lassen. */
export async function clearWidgetSnapshot(): Promise<void> {
  await publishWidgetSnapshot({
    generatedAtMs: Date.now(),
    dueToday: 0,
    overdue: 0,
    tasks: [],
  })
}
