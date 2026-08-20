import type { IsoDateTime, Recurrence } from '@/data/types'

/**
 * Schnellerfassung mit natürlicher Sprache.
 *
 *   "Steuer machen morgen !!"        -> morgen, Priorität hoch
 *   "Müll rausbringen jeden montag"  -> nächster Montag, wöchentlich
 *   "Anruf Chef am 5.12. um 14:30"   -> 5. Dezember, 14:30 Uhr
 *   "Milch #einkaufen"               -> landet in der Liste "Einkaufen"
 *
 * Warum überhaupt ein Parser statt vier Eingabefelder? Weil das Erfassen
 * schnell gehen muss. Wer erst ein Datumsfeld anklicken muss, notiert die
 * Aufgabe irgendwann gar nicht mehr.
 *
 * Regel bei allem hier: im Zweifel NICHT erkennen. Ein nicht erkanntes
 * "morgen" ist ein kleiner Nachteil - ein fälschlich als Datum geschlucktes
 * Wort im Titel ist ein Fehler, den man erst merkt, wenn die Aufgabe fehlt.
 */

export interface QuickAddResult {
  title: string
  dueAt: IsoDateTime | null
  allDay: boolean
  priority: number | null
  recurrence: Recurrence | null
  /** Listenname aus "#name" - der Aufrufer sucht die passende Liste. */
  listHint: string | null
  /** Welche Bestandteile erkannt wurden - fuer die Vorschau unter dem Feld. */
  matched: string[]
}

const WEEKDAYS: Record<string, number> = {
  sonntag: 0, so: 0,
  montag: 1, mo: 1,
  dienstag: 2, di: 2,
  mittwoch: 3, mi: 3,
  donnerstag: 4, do: 4,
  freitag: 5, fr: 5,
  samstag: 6, sa: 6, sonnabend: 6,
}

const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join('|')

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  let text = ` ${input} `
  const matched: string[] = []

  let dueDate: Date | null = null
  let time: { hour: number; minute: number } | null = null
  let priority: number | null = null
  let recurrence: Recurrence | null = null
  let listHint: string | null = null

  /** Entfernt den Treffer aus dem Titel und merkt ihn fuer die Vorschau. */
  const consume = (match: RegExpMatchArray, label: string) => {
    text = text.replace(match[0], ' ')
    matched.push(label)
  }

  // --- Liste: #name ---------------------------------------------------------
  const list = text.match(/\s#([\p{L}\d_-]+)/u)
  if (list?.[1]) {
    listHint = list[1]
    consume(list, `Liste: ${list[1]}`)
  }

  // --- Priorität: !, !!, !!! -----------------------------------------------
  // Nur als eigenstehendes Token, damit "Wow!" im Titel nichts ausloest.
  const prio = text.match(/\s(!{1,3})(?=\s)/)
  if (prio?.[1]) {
    priority = prio[1].length
    consume(prio, `Priorität ${['', 'niedrig', 'mittel', 'hoch'][priority]}`)
  }

  // --- Wiederholung ---------------------------------------------------------
  // Vor der Datumserkennung, weil "jeden montag" sonst als einfacher
  // Wochentag durchginge und die Wiederholung verloren waere.
  const everyWeekday = text.match(new RegExp(`\\sjede[nr]?\\s+(${WEEKDAY_NAMES})\\b`, 'i'))
  const recurrences: [RegExp, Recurrence, string][] = [
    [/\s(t[äa]glich|jeden\s+tag)\b/i, 'daily', 'täglich'],
    [/\s(werktags|jeden\s+werktag|wochentags)\b/i, 'weekdays', 'werktags'],
    [/\s(w[öo]chentlich|jede\s+woche)\b/i, 'weekly', 'wöchentlich'],
    [/\s(monatlich|jeden\s+monat)\b/i, 'monthly', 'monatlich'],
    [/\s(j[äa]hrlich|jedes\s+jahr)\b/i, 'yearly', 'jährlich'],
  ]

  if (everyWeekday?.[1]) {
    recurrence = 'weekly'
    dueDate = nextWeekday(now, WEEKDAYS[everyWeekday[1].toLowerCase()]!, false)
    consume(everyWeekday, `wöchentlich ab ${everyWeekday[1]}`)
  } else {
    for (const [pattern, value, label] of recurrences) {
      const hit = text.match(pattern)
      if (!hit) continue
      recurrence = value
      consume(hit, label)
      break
    }
  }

  // --- Uhrzeit: "um 14:30", "14:30", "9 uhr" -------------------------------
  const clock =
    text.match(/\s(?:um\s+)?(\d{1,2}):(\d{2})\s*(?:uhr)?(?=\s)/i) ??
    text.match(/\s(?:um\s+)?(\d{1,2})\s*uhr(?=\s)/i)
  if (clock) {
    const hour = Number(clock[1])
    const minute = Number(clock[2] ?? 0)
    if (hour <= 23 && minute <= 59) {
      time = { hour, minute }
      consume(clock, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Uhr`)
    }
  }

  // --- Datum ----------------------------------------------------------------
  if (!dueDate) dueDate = parseDate(text, now, consume)

  // --- Titel aufraeumen -----------------------------------------------------
  const title = text.replace(/\s+/g, ' ').trim()

  // Eine Wiederholung ohne Startdatum beginnt heute - sonst haette man eine
  // wiederkehrende Aufgabe, die nie faellig wird.
  if (recurrence && !dueDate) dueDate = startOfDay(now)

  let dueAt: string | null = null
  if (dueDate) {
    const result = new Date(dueDate)
    // Ganztags wird auf 12:00 lokal gelegt: so kippt der Termin bei keiner
    // Zeitzonenumrechnung auf den Vor- oder Folgetag.
    result.setHours(time?.hour ?? 12, time?.minute ?? 0, 0, 0)
    dueAt = result.toISOString()
  }

  return {
    title,
    dueAt,
    allDay: time === null,
    priority,
    recurrence,
    listHint,
    matched,
  }
}

type Consume = (match: RegExpMatchArray, label: string) => void

function parseDate(text: string, now: Date, consume: Consume): Date | null {
  // "heute" / "morgen" / "übermorgen" / "gestern"
  const relatives: [RegExp, number, string][] = [
    [/\s[üu]bermorgen\b/i, 2, 'übermorgen'],
    [/\smorgen\b/i, 1, 'morgen'],
    [/\sheute\b/i, 0, 'heute'],
    [/\sgestern\b/i, -1, 'gestern'],
  ]
  for (const [pattern, offset, label] of relatives) {
    const hit = text.match(pattern)
    if (!hit) continue
    consume(hit, label)
    return addDays(startOfDay(now), offset)
  }

  // "in 3 tagen", "in 2 wochen"
  const inN = text.match(/\sin\s+(\d{1,3})\s+(tag(?:en)?|wochen?|monaten?)\b/i)
  if (inN?.[1] && inN[2]) {
    const amount = Number(inN[1])
    const unit = inN[2].toLowerCase()
    consume(inN, `in ${amount} ${unit}`)
    const base = startOfDay(now)
    if (unit.startsWith('tag')) return addDays(base, amount)
    if (unit.startsWith('woche')) return addDays(base, amount * 7)
    return addMonths(base, amount)
  }

  // "nächste woche"
  const nextWeek = text.match(/\sn[äa]chste\s+woche\b/i)
  if (nextWeek) {
    consume(nextWeek, 'nächste Woche')
    return addDays(startOfDay(now), 7)
  }

  // "nächsten montag" -> überspringt den heutigen Tag bewusst
  const nextNamed = text.match(new RegExp(`\\sn[äa]chste[nr]?\\s+(${WEEKDAY_NAMES})\\b`, 'i'))
  if (nextNamed?.[1]) {
    consume(nextNamed, `nächster ${nextNamed[1]}`)
    return nextWeekday(now, WEEKDAYS[nextNamed[1].toLowerCase()]!, true)
  }

  // "am montag" / "montag" -> der nächste dieses Namens, heute eingeschlossen
  const named = text.match(new RegExp(`\\s(?:am\\s+)?(${WEEKDAY_NAMES})\\b`, 'i'))
  if (named?.[1]) {
    consume(named, named[1])
    return nextWeekday(now, WEEKDAYS[named[1].toLowerCase()]!, false)
  }

  // "am 5.12." / "5.12.2026" / "5.12"
  const numeric = text.match(/\s(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?=\s|$)/)
  if (numeric?.[1] && numeric[2]) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const yearRaw = numeric[3]
      let year = yearRaw ? Number(yearRaw) : now.getFullYear()
      if (yearRaw && yearRaw.length === 2) year += 2000

      let date = new Date(year, month - 1, day, 12, 0, 0, 0)
      // Ohne Jahresangabe und schon vorbei? Dann ist das nächste Jahr gemeint.
      if (!yearRaw && date.getTime() < startOfDay(now).getTime()) {
        date = new Date(year + 1, month - 1, day, 12, 0, 0, 0)
      }
      // Ungültige Tage wie 31.02. verwirft der Date-Konstruktor still, indem
      // er in den Folgemonat rutscht - das faengt diese Pruefung ab.
      if (date.getMonth() !== month - 1) return null

      consume(numeric, `${day}.${month}.`)
      return startOfDay(date)
    }
  }

  return null
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date)
  copy.setMonth(copy.getMonth() + months)
  return copy
}

/** Nächster Wochentag mit diesem Index. `skipToday` erzwingt mindestens +1. */
function nextWeekday(now: Date, weekday: number, skipToday: boolean): Date {
  const base = startOfDay(now)
  let delta = (weekday - base.getDay() + 7) % 7
  if (delta === 0 && skipToday) delta = 7
  return addDays(base, delta)
}
