import { get, set } from 'idb-keyval'
import { newId } from '@/lib/id'
import { keyAtEnd } from '@/lib/ordering'
import { todayIso } from '@/lib/date'
import type { Repository } from './repository'
import type {
  IsoDate,
  List,
  ListInvite,
  ListMember,
  ListPatch,
  NewList,
  NewTask,
  PlannerBackup,
  Task,
  TaskPatch,
} from './types'

/**
 * Repository ohne Backend: alles liegt in IndexedDB auf diesem Geraet.
 *
 * Zweck ist nicht, ein zweites Produkt zu bauen, sondern zwei praktische
 * Dinge zu koennen:
 *   1. Die App laeuft sofort nach `npm run dev`, ohne Supabase-Projekt.
 *   2. Das Repository-Interface ist damit nachweislich implementierbar,
 *      ohne dass "Supabase" durchscheint. Genau das braucht spaeter auch
 *      der PowerSync- oder Eigenserver-Adapter.
 *
 * Was hier fehlt, fehlt bewusst: Teilen und Live-Sync gibt es ohne Server
 * nicht, die entsprechenden Methoden lehnen freundlich ab.
 */

const DB_KEY = 'planner:db:v2'
const USER_KEY = 'planner:device-user'

interface LocalDb {
  lists: List[]
  tasks: Task[]
}

const emptyDb = (): LocalDb => ({ lists: [], tasks: [] })

function deviceUserId(): string {
  let id = localStorage.getItem(USER_KEY)
  if (!id) {
    id = newId()
    localStorage.setItem(USER_KEY, id)
  }
  return id
}

const now = () => new Date().toISOString()
const alive = <T extends { deletedAt: string | null }>(rows: T[]) =>
  rows.filter((r) => r.deletedAt === null)

export class LocalRepository implements Repository {
  readonly kind = 'local' as const
  readonly supportsSharing = false

  private db: LocalDb = emptyDb()
  private ready: Promise<void>
  private readonly userId = deviceUserId()
  /** Schreibvorgaenge serialisieren, damit sich zwei Mutationen nicht
   *  gegenseitig ueberschreiben (read-modify-write auf demselben Objekt). */
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor() {
    this.ready = this.load()
  }

  private async load(): Promise<void> {
    const stored = await get<LocalDb>(DB_KEY)
    if (stored) {
      this.db = { ...emptyDb(), ...stored }
      return
    }
    this.db = seed(this.userId)
    await set(DB_KEY, this.db)
  }

  private async mutate<T>(fn: () => T): Promise<T> {
    await this.ready
    const run = this.writeQueue.then(async () => {
      const result = fn()
      await set(DB_KEY, this.db)
      return result
    })
    this.writeQueue = run.catch(() => undefined)
    return run
  }

  private async read<T>(fn: () => T): Promise<T> {
    await this.ready
    return fn()
  }

  currentUserId(): string {
    return this.userId
  }

  // ------------------------------------------------------------------ Listen

  getLists(): Promise<List[]> {
    return this.read(() => alive(this.db.lists))
  }

  createList(input: NewList): Promise<List> {
    return this.mutate(() => {
      const list: List = {
        id: newId(),
        ownerId: this.userId,
        name: input.name.trim(),
        color: input.color ?? null,
        position: keyAtEnd(alive(this.db.lists)),
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      }
      this.db.lists.push(list)
      return list
    })
  }

  updateList(id: string, patch: ListPatch): Promise<List> {
    return this.mutate(() => {
      const list = this.db.lists.find((l) => l.id === id)
      if (!list) throw new Error(`Liste ${id} nicht gefunden`)
      Object.assign(list, patch, { updatedAt: now() })
      return { ...list }
    })
  }

  deleteList(id: string): Promise<void> {
    return this.mutate(() => {
      const stamp = now()
      for (const list of this.db.lists) {
        if (list.id === id) list.deletedAt = stamp
      }
      // Aufgaben mitnehmen - sonst tauchen sie in listenuebergreifenden
      // Abfragen wie getDueTasks() weiter auf.
      for (const task of this.db.tasks) {
        if (task.listId === id) task.deletedAt = stamp
      }
    })
  }

  // ----------------------------------------------------------------- Aufgaben

  getTasks(listId: string): Promise<Task[]> {
    return this.read(() => alive(this.db.tasks).filter((t) => t.listId === listId))
  }

  getAllTasks(): Promise<Task[]> {
    return this.read(() => alive(this.db.tasks))
  }

  createTask(input: NewTask): Promise<Task> {
    return this.mutate(() => {
      const siblings = alive(this.db.tasks).filter(
        (t) => t.listId === input.listId && t.parentId === (input.parentId ?? null),
      )
      const task: Task = {
        id: newId(),
        listId: input.listId,
        parentId: input.parentId ?? null,
        title: input.title.trim(),
        notes: input.notes ?? null,
        done: false,
        completedAt: null,
        dueAt: input.dueAt ?? null,
        allDay: input.allDay ?? true,
        priority: input.priority ?? null,
        recurrence: input.recurrence ?? null,
        position: input.position ?? keyAtEnd(siblings),
        createdBy: this.userId,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      }
      this.db.tasks.push(task)
      return task
    })
  }

  updateTask(id: string, patch: TaskPatch): Promise<Task> {
    return this.mutate(() => {
      const task = this.db.tasks.find((t) => t.id === id)
      if (!task) throw new Error(`Aufgabe ${id} nicht gefunden`)

      Object.assign(task, patch, { updatedAt: now() })
      if (patch.done !== undefined) {
        task.completedAt = patch.done ? (task.completedAt ?? now()) : null
      }
      return { ...task }
    })
  }

  deleteTask(id: string): Promise<string[]> {
    return this.mutate(() => {
      const stamp = now()
      // Unterpunkte rekursiv mitloeschen.
      const doomed = new Set([id])
      let grew = true
      while (grew) {
        grew = false
        for (const task of this.db.tasks) {
          if (task.parentId && doomed.has(task.parentId) && !doomed.has(task.id)) {
            doomed.add(task.id)
            grew = true
          }
        }
      }
      for (const task of this.db.tasks) {
        if (doomed.has(task.id)) task.deletedAt = stamp
      }
      return [...doomed]
    })
  }

  restoreTasks(ids: string[]): Promise<void> {
    return this.mutate(() => {
      const wanted = new Set(ids)
      for (const task of this.db.tasks) {
        if (wanted.has(task.id)) task.deletedAt = null
      }
    })
  }

  getDueTasks(through: IsoDate): Promise<Task[]> {
    return this.read(() => {
      const limit = new Date(`${through}T23:59:59.999`).getTime()
      return alive(this.db.tasks).filter(
        (t) => !t.done && t.dueAt !== null && new Date(t.dueAt).getTime() <= limit,
      )
    })
  }

  // ------------------------------------------------------------------ Teilen

  async getMembers(listId: string): Promise<ListMember[]> {
    return [
      {
        listId,
        userId: this.userId,
        role: 'owner',
        email: null,
        displayName: 'Ich (lokal)',
        avatarUrl: null,
      },
    ]
  }

  async getInvites(): Promise<ListInvite[]> {
    return []
  }

  async inviteToList(): Promise<ListInvite> {
    throw new Error(sharingUnavailable)
  }

  async revokeInvite(): Promise<void> {
    throw new Error(sharingUnavailable)
  }

  async acceptInvite(): Promise<string> {
    throw new Error(sharingUnavailable)
  }

  async removeMember(): Promise<void> {
    throw new Error(sharingUnavailable)
  }

  async changeMemberRole(): Promise<void> {
    throw new Error(sharingUnavailable)
  }

  async leaveList(): Promise<void> {
    throw new Error(sharingUnavailable)
  }

  // ---------------------------------------------------------- Export / Import

  exportAll(): Promise<PlannerBackup> {
    return this.read(() => ({
      version: 1 as const,
      exportedAt: now(),
      lists: alive(this.db.lists),
      tasks: alive(this.db.tasks),
    }))
  }

  importBackup(backup: PlannerBackup): Promise<{ lists: number; tasks: number }> {
    return this.mutate(() => {
      // Neue IDs vergeben: ein Import darf bestehende Daten nie ueberschreiben.
      const listIds = new Map<string, string>()
      const taskIds = new Map<string, string>()

      for (const list of backup.lists) {
        const id = newId()
        listIds.set(list.id, id)
        this.db.lists.push({
          ...list,
          id,
          ownerId: this.userId,
          name: `${list.name} (Import)`,
          createdAt: now(),
          updatedAt: now(),
          deletedAt: null,
        })
      }

      for (const task of backup.tasks) {
        if (!listIds.has(task.listId)) continue
        taskIds.set(task.id, newId())
      }
      for (const task of backup.tasks) {
        const id = taskIds.get(task.id)
        const listId = listIds.get(task.listId)
        if (!id || !listId) continue
        this.db.tasks.push({
          ...task,
          id,
          listId,
          // Zeigt der Elternteil auf etwas, das nicht mitimportiert wurde,
          // wird der Unterpunkt zur Hauptaufgabe - besser als ihn zu verlieren.
          parentId: task.parentId ? (taskIds.get(task.parentId) ?? null) : null,
          createdBy: this.userId,
          deletedAt: null,
        })
      }

      return { lists: listIds.size, tasks: taskIds.size }
    })
  }

  // -------------------------------------------------------------- Live-Sync

  subscribeToAll(): () => void {
    // Ein Geraet, eine Quelle - es gibt niemanden, der von aussen aendert.
    return () => {}
  }
}

const sharingUnavailable =
  'Geteilte Listen brauchen ein Supabase-Projekt. Siehe README, Abschnitt "Supabase einrichten".'

/** Erstbefuellung, damit die App nicht als leeres Fenster startet. */
function seed(userId: string): LocalDb {
  const stamp = new Date().toISOString()
  const today = todayIso()

  const mkList = (name: string, color: string, pos: string): List => ({
    id: newId(),
    ownerId: userId,
    name,
    color,
    position: pos,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  })

  const privat = mkList('Persönlich', '#2E6F50', 'a0')
  const arbeit = mkList('Arbeit', '#2D6396', 'a1')
  const einkauf = mkList('Einkaufen', '#4E7A34', 'a2')

  let counter = 0
  const mkTask = (listId: string, title: string, extra: Partial<Task> = {}): Task => ({
    id: newId(),
    listId,
    parentId: null,
    title,
    notes: null,
    done: false,
    completedAt: null,
    dueAt: null,
    allDay: true,
    priority: null,
    recurrence: null,
    position: `a${counter++}`,
    createdBy: userId,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...extra,
  })

  const setup = mkTask(privat.id, 'Supabase-Projekt anlegen', {
    dueAt: `${today}T12:00:00.000Z`,
    priority: 3,
    position: 'a0',
  })

  const tasks: Task[] = [
    setup,
    mkTask(privat.id, 'Schema aus supabase/migrations einspielen', {
      parentId: setup.id,
      position: 'a0',
    }),
    mkTask(privat.id, 'URL und anon-Key in .env.local eintragen', {
      parentId: setup.id,
      position: 'a1',
    }),
    mkTask(privat.id, 'Eine Liste mit jemandem teilen', { position: 'a1' }),
    mkTask(privat.id, 'Fahrrad zur Werkstatt bringen', { position: 'a2' }),
    mkTask(privat.id, 'Müll rausbringen', {
      dueAt: `${today}T12:00:00.000Z`,
      recurrence: 'weekly',
      position: 'a3',
    }),

    mkTask(arbeit.id, 'Angebot durchsehen', {
      dueAt: `${today}T12:00:00.000Z`,
      priority: 2,
      position: 'a0',
    }),
    mkTask(arbeit.id, 'Präsentation vorbereiten', { position: 'a1' }),
    mkTask(arbeit.id, 'Rückmeldung an das Team', { done: true, completedAt: stamp, position: 'a2' }),

    mkTask(einkauf.id, 'Kaffee', { position: 'a0' }),
    mkTask(einkauf.id, 'Olivenöl', { position: 'a1' }),
    mkTask(einkauf.id, 'Zahnpasta', { done: true, completedAt: stamp, position: 'a2' }),
  ]

  return { lists: [privat, arbeit, einkauf], tasks }
}
