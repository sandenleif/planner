import { de } from 'date-fns/locale'
import {
  addDays as fnsAddDays,
  differenceInCalendarDays,
  format,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
  startOfWeek,
} from 'date-fns'
import type { IsoDate } from '@/data/types'

/**
 * Ein Kalendertag ist hier immer LOKAL gemeint, nie UTC.
 *
 * Der Unterschied ist keine Haarspalterei: `new Date().toISOString()` liefert
 * in Mitteleuropa zwischen 00:00 und 02:00 den Vortag. Ein Habit-Tracker, der
 * nachts um halb eins das gestrige Kaestchen ankreuzt, ist kaputt.
 */

export function toIsoDate(date: Date): IsoDate {
  return format(date, 'yyyy-MM-dd')
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date())
}

/** 'YYYY-MM-DD' -> Date auf lokaler Mitternacht. */
export function fromIsoDate(value: IsoDate): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function addDaysIso(value: IsoDate, days: number): IsoDate {
  return toIsoDate(fnsAddDays(fromIsoDate(value), days))
}

/** Die letzten `count` Tage, aeltester zuerst, endend bei `end` (Vorgabe heute). */
export function lastDays(count: number, end: IsoDate = todayIso()): IsoDate[] {
  return Array.from({ length: count }, (_, i) => addDaysIso(end, i - count + 1))
}

/** Montag der Woche, in der `value` liegt. */
export function weekStartIso(value: IsoDate = todayIso()): IsoDate {
  return toIsoDate(startOfWeek(fromIsoDate(value), { weekStartsOn: 1 }))
}

export function weekdayShort(value: IsoDate): string {
  return format(fromIsoDate(value), 'EEEEEE', { locale: de })
}

export function dayNumber(value: IsoDate): string {
  return format(fromIsoDate(value), 'd')
}

/** "Heute", "Morgen", "Fr, 22. Aug" - fuer Faelligkeiten. */
export function formatDueDate(iso: string, allDay: boolean): string {
  const date = parseISO(iso)
  const time = allDay ? '' : ` ${format(date, 'HH:mm')}`

  if (isToday(date)) return `Heute${time}`
  if (isTomorrow(date)) return `Morgen${time}`
  if (isYesterday(date)) return `Gestern${time}`

  const sameYear = date.getFullYear() === new Date().getFullYear()
  return format(date, sameYear ? 'EE, d. MMM' : 'd. MMM yyyy', { locale: de }) + time
}

/** Negativ = ueberfaellig. */
export function daysUntil(iso: string): number {
  return differenceInCalendarDays(parseISO(iso), new Date())
}

export function isOverdue(iso: string | null): boolean {
  return iso !== null && parseISO(iso).getTime() < Date.now()
}

/** Sekunden als 'MM:SS' bzw. 'H:MM:SS'. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
