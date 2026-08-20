/**
 * Domaenentypen der App.
 *
 * Bewusst entkoppelt vom DB-Schema: hier camelCase, in Postgres snake_case.
 * Die Uebersetzung passiert genau an einer Stelle (supabaseRepository.ts).
 * Klingt nach unnoetiger Arbeit, ist aber der Grund, warum ein Wechsel des
 * Backends spaeter keine 200 Komponenten anfasst.
 *
 * Zeitstempel sind durchgehend ISO-8601-Strings (UTC), keine Date-Objekte:
 * so sind sie ohne Sonderbehandlung serialisierbar - fuer den Query-Cache in
 * IndexedDB und spaeter fuer die Bruecke zum Android-Widget.
 */

export type MemberRole = 'owner' | 'editor' | 'viewer'

/**
 * Wiederholungsrhythmus. Bewusst eine kleine Aufzaehlung statt einer vollen
 * RRULE (RFC 5545): das deckt praktisch alle Alltagsfaelle ab und laesst sich
 * ohne Bibliothek rechnen. Braucht es spaeter "jeden 2. Dienstag im Monat",
 * ist das der Punkt, an dem ein rrule-Feld dazukommt.
 */
export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'

/** Kalendertag als 'YYYY-MM-DD' in lokaler Zeit. Siehe lib/date.ts. */
export type IsoDate = string
/** Zeitpunkt als ISO-8601 mit Zone, z. B. '2026-08-20T09:30:00.000Z'. */
export type IsoDateTime = string

export interface List {
  id: string
  ownerId: string
  name: string
  color: string | null
  position: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  deletedAt: IsoDateTime | null
}

export interface Task {
  id: string
  listId: string
  parentId: string | null
  title: string
  notes: string | null
  done: boolean
  completedAt: IsoDateTime | null
  dueAt: IsoDateTime | null
  allDay: boolean
  /** 0 = keine, 1 = niedrig, 2 = mittel, 3 = hoch. */
  priority: number | null
  /** Gesetzt = beim Abhaken entsteht automatisch die naechste Aufgabe. */
  recurrence: Recurrence | null
  position: string
  createdBy: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  deletedAt: IsoDateTime | null
}

/** Task samt aufgeloester Unterpunkte - was die UI tatsaechlich rendert. */
export interface TaskNode extends Task {
  children: TaskNode[]
  depth: number
}

export interface ListMember {
  listId: string
  userId: string
  role: MemberRole
  email: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface ListInvite {
  id: string
  listId: string
  email: string
  role: MemberRole
  token: string
  createdAt: IsoDateTime
  expiresAt: IsoDateTime
  acceptedAt: IsoDateTime | null
}

// ---------------------------------------------------------------- Eingaben

export interface NewList {
  name: string
  color?: string | null
}

export interface NewTask {
  listId: string
  title: string
  parentId?: string | null
  notes?: string | null
  dueAt?: IsoDateTime | null
  allDay?: boolean
  priority?: number | null
  recurrence?: Recurrence | null
  /** Einfuegeposition; ohne Angabe landet die Aufgabe am Ende. */
  position?: string
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'done'
    | 'dueAt'
    | 'allDay'
    | 'priority'
    | 'recurrence'
    | 'position'
    | 'parentId'
  >
>

export type ListPatch = Partial<Pick<List, 'name' | 'color' | 'position'>>

/**
 * Vollstaendiger Datenstand - was Export/Import und der geplante Google-Sync
 * als Einheit bewegen.
 */
export interface PlannerBackup {
  version: 1
  exportedAt: IsoDateTime
  lists: List[]
  tasks: Task[]
}
