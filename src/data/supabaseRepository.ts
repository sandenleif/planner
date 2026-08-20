import type { SupabaseClient } from '@supabase/supabase-js'
import { newId } from '@/lib/id'
import { keyAtEnd } from '@/lib/ordering'
import type { Repository } from './repository'
import type {
  IsoDate,
  List,
  ListInvite,
  ListMember,
  ListPatch,
  MemberRole,
  NewList,
  NewTask,
  PlannerBackup,
  Recurrence,
  Task,
  TaskPatch,
} from './types'

/**
 * Repository gegen Supabase.
 *
 * Das ist die einzige Datei, die Postgres-Spaltennamen kennt. Alles darueber
 * spricht ausschliesslich die Domaenentypen aus types.ts.
 *
 * Was hier bewusst NICHT passiert: Berechtigungspruefungen. Die stehen als
 * RLS-Policies in der Datenbank (siehe supabase/migrations/0002_rls.sql).
 * Ein `if (user.role !== 'owner')` im Client waere Kosmetik - jeder mit dem
 * anon-Key koennte die REST-API direkt ansprechen.
 */

// --------------------------------------------------------------- Zeilentypen

interface ListRow {
  id: string
  owner_id: string
  name: string
  color: string | null
  position: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface TaskRow {
  id: string
  list_id: string
  parent_id: string | null
  title: string
  notes: string | null
  done: boolean
  completed_at: string | null
  due_at: string | null
  all_day: boolean
  priority: number | null
  recurrence: Recurrence | null
  position: string
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface ProfileRow {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
}

interface MemberRow {
  list_id: string
  user_id: string
  role: MemberRole
  profiles: ProfileRow | null
}

interface InviteRow {
  id: string
  list_id: string
  email: string
  role: MemberRole
  token: string
  created_at: string
  expires_at: string
  accepted_at: string | null
}

// ----------------------------------------------------------------- Mapping

const toList = (r: ListRow): List => ({
  id: r.id,
  ownerId: r.owner_id,
  name: r.name,
  color: r.color,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
})

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  listId: r.list_id,
  parentId: r.parent_id,
  title: r.title,
  notes: r.notes,
  done: r.done,
  completedAt: r.completed_at,
  dueAt: r.due_at,
  allDay: r.all_day,
  priority: r.priority,
  recurrence: r.recurrence,
  position: r.position,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
})

const toInvite = (r: InviteRow): ListInvite => ({
  id: r.id,
  listId: r.list_id,
  email: r.email,
  role: r.role,
  token: r.token,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  acceptedAt: r.accepted_at,
})

/** Nur definierte Felder uebernehmen - undefined wuerde Spalten auf NULL setzen. */
function taskPatchToRow(patch: TaskPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.done !== undefined) row.done = patch.done
  if (patch.dueAt !== undefined) row.due_at = patch.dueAt
  if (patch.allDay !== undefined) row.all_day = patch.allDay
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.recurrence !== undefined) row.recurrence = patch.recurrence
  if (patch.position !== undefined) row.position = patch.position
  if (patch.parentId !== undefined) row.parent_id = patch.parentId
  return row
}

/** Supabase-Fehler in etwas verwandeln, das man einem Menschen zeigen kann. */
function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('Keine Daten erhalten')
  return result.data
}

// -------------------------------------------------------------- Repository

export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const
  readonly supportsSharing = true

  // Explizite Felder statt Parameter-Properties: tsconfig hat
  // erasableSyntaxOnly gesetzt, damit der Build ohne TS-spezifische
  // Laufzeit-Transformation auskommt.
  private readonly sb: SupabaseClient
  private readonly userId: string

  constructor(sb: SupabaseClient, userId: string) {
    this.sb = sb
    this.userId = userId
  }

  currentUserId(): string {
    return this.userId
  }

  // ------------------------------------------------------------------ Listen

  async getLists(): Promise<List[]> {
    const rows = unwrap(
      await this.sb.from('lists').select('*').is('deleted_at', null).order('position'),
    ) as ListRow[]
    return rows.map(toList)
  }

  async createList(input: NewList): Promise<List> {
    const existing = await this.getLists()
    const row = unwrap(
      await this.sb
        .from('lists')
        .insert({
          id: newId(),
          owner_id: this.userId,
          name: input.name.trim(),
          color: input.color ?? null,
          position: keyAtEnd(existing),
        })
        .select()
        .single(),
    ) as ListRow
    return toList(row)
  }

  async updateList(id: string, patch: ListPatch): Promise<List> {
    const row: Record<string, unknown> = {}
    if (patch.name !== undefined) row.name = patch.name
    if (patch.color !== undefined) row.color = patch.color
    if (patch.position !== undefined) row.position = patch.position

    const updated = unwrap(
      await this.sb.from('lists').update(row).eq('id', id).select().single(),
    ) as ListRow
    return toList(updated)
  }

  async deleteList(id: string): Promise<void> {
    const stamp = new Date().toISOString()
    // Aufgaben zuerst: bricht der zweite Aufruf ab, ist die Liste noch sichtbar
    // und der Nutzer kann es erneut versuchen. Andersherum haette er eine
    // unsichtbare Liste mit sichtbaren Aufgaben.
    const tasks = await this.sb
      .from('tasks')
      .update({ deleted_at: stamp })
      .eq('list_id', id)
    if (tasks.error) throw new Error(tasks.error.message)

    const list = await this.sb.from('lists').update({ deleted_at: stamp }).eq('id', id)
    if (list.error) throw new Error(list.error.message)
  }

  // ----------------------------------------------------------------- Aufgaben

  async getTasks(listId: string): Promise<Task[]> {
    const rows = unwrap(
      await this.sb
        .from('tasks')
        .select('*')
        .eq('list_id', listId)
        .is('deleted_at', null)
        .order('position'),
    ) as TaskRow[]
    return rows.map(toTask)
  }

  async getAllTasks(): Promise<Task[]> {
    const rows = unwrap(
      await this.sb.from('tasks').select('*').is('deleted_at', null).order('position'),
    ) as TaskRow[]
    return rows.map(toTask)
  }

  async createTask(input: NewTask): Promise<Task> {
    let position = input.position
    if (!position) {
      const siblings = unwrap(
        await this.sb
          .from('tasks')
          .select('position')
          .eq('list_id', input.listId)
          .is('deleted_at', null)
          .filter('parent_id', input.parentId ? 'eq' : 'is', input.parentId ?? null),
      ) as { position: string }[]
      position = keyAtEnd(siblings)
    }

    const row = unwrap(
      await this.sb
        .from('tasks')
        .insert({
          id: newId(),
          list_id: input.listId,
          parent_id: input.parentId ?? null,
          title: input.title.trim(),
          notes: input.notes ?? null,
          due_at: input.dueAt ?? null,
          all_day: input.allDay ?? true,
          priority: input.priority ?? null,
          recurrence: input.recurrence ?? null,
          position,
          created_by: this.userId,
        })
        .select()
        .single(),
    ) as TaskRow
    return toTask(row)
  }

  async updateTask(id: string, patch: TaskPatch): Promise<Task> {
    const row = unwrap(
      await this.sb
        .from('tasks')
        .update(taskPatchToRow(patch))
        .eq('id', id)
        .select()
        .single(),
    ) as TaskRow
    return toTask(row)
  }

  async deleteTask(id: string): Promise<string[]> {
    // ON DELETE CASCADE greift beim Soft-Delete nicht, also die Unterpunkte
    // selbst einsammeln. Bei ueblichen Verschachtelungstiefen sind das
    // zwei bis drei Runden.
    const stamp = new Date().toISOString()
    let frontier = [id]
    const all = new Set(frontier)

    while (frontier.length > 0) {
      const children = unwrap(
        await this.sb
          .from('tasks')
          .select('id')
          .in('parent_id', frontier)
          .is('deleted_at', null),
      ) as { id: string }[]

      frontier = children.map((c) => c.id).filter((cid) => !all.has(cid))
      for (const cid of frontier) all.add(cid)
    }

    const result = await this.sb
      .from('tasks')
      .update({ deleted_at: stamp })
      .in('id', [...all])
    if (result.error) throw new Error(result.error.message)

    return [...all]
  }

  async restoreTasks(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const result = await this.sb
      .from('tasks')
      .update({ deleted_at: null })
      .in('id', ids)
    if (result.error) throw new Error(result.error.message)
  }

  async getDueTasks(through: IsoDate): Promise<Task[]> {
    const end = new Date(`${through}T23:59:59.999`).toISOString()
    const rows = unwrap(
      await this.sb
        .from('tasks')
        .select('*')
        .eq('done', false)
        .is('deleted_at', null)
        .not('due_at', 'is', null)
        .lte('due_at', end)
        .order('due_at'),
    ) as TaskRow[]
    return rows.map(toTask)
  }

  // ------------------------------------------------------------------ Teilen

  async getMembers(listId: string): Promise<ListMember[]> {
    const rows = unwrap(
      await this.sb
        .from('list_members')
        .select('list_id, user_id, role, profiles:profiles!list_members_user_id_fkey(*)')
        .eq('list_id', listId),
    ) as unknown as MemberRow[]

    return rows.map((r) => ({
      listId: r.list_id,
      userId: r.user_id,
      role: r.role,
      email: r.profiles?.email ?? null,
      displayName: r.profiles?.display_name ?? null,
      avatarUrl: r.profiles?.avatar_url ?? null,
    }))
  }

  async getInvites(listId: string): Promise<ListInvite[]> {
    const rows = unwrap(
      await this.sb
        .from('list_invites')
        .select('*')
        .eq('list_id', listId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ) as InviteRow[]
    return rows.map(toInvite)
  }

  async inviteToList(
    listId: string,
    email: string,
    role: MemberRole,
  ): Promise<ListInvite> {
    const row = unwrap(
      await this.sb
        .from('list_invites')
        .insert({
          list_id: listId,
          email: email.trim().toLowerCase(),
          role,
          invited_by: this.userId,
        })
        .select()
        .single(),
    ) as InviteRow
    return toInvite(row)
  }

  async revokeInvite(inviteId: string): Promise<void> {
    const result = await this.sb.from('list_invites').delete().eq('id', inviteId)
    if (result.error) throw new Error(result.error.message)
  }

  async acceptInvite(token: string): Promise<string> {
    const result = await this.sb.rpc('accept_list_invite', { p_token: token })
    if (result.error) throw new Error(result.error.message)
    return result.data as string
  }

  async removeMember(listId: string, userId: string): Promise<void> {
    const result = await this.sb
      .from('list_members')
      .delete()
      .eq('list_id', listId)
      .eq('user_id', userId)
    if (result.error) throw new Error(result.error.message)
  }

  async changeMemberRole(
    listId: string,
    userId: string,
    role: MemberRole,
  ): Promise<void> {
    const result = await this.sb
      .from('list_members')
      .update({ role })
      .eq('list_id', listId)
      .eq('user_id', userId)
    if (result.error) throw new Error(result.error.message)
  }

  async leaveList(listId: string): Promise<void> {
    await this.removeMember(listId, this.userId)
  }

  // ---------------------------------------------------------- Export / Import

  async exportAll(): Promise<PlannerBackup> {
    const [lists, tasks] = await Promise.all([this.getLists(), this.getAllTasks()])
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      lists,
      tasks,
    }
  }

  async importBackup(backup: PlannerBackup): Promise<{ lists: number; tasks: number }> {
    const listIds = new Map<string, string>()

    for (const list of backup.lists) {
      const created = await this.createList({
        name: `${list.name} (Import)`,
        color: list.color,
      })
      listIds.set(list.id, created.id)
    }

    // Eltern muessen vor ihren Kindern existieren - der Trigger tasks_guard
    // prueft beim INSERT, ob parent_id auffindbar ist. Also Ebene fuer Ebene.
    const taskIds = new Map<string, string>()
    let pending = backup.tasks.filter((t) => listIds.has(t.listId))
    let inserted = 0

    while (pending.length > 0) {
      const ready = pending.filter((t) => t.parentId === null || taskIds.has(t.parentId))
      // Verwaiste Unterpunkte (Elternteil fehlt im Backup) haengen wir an die
      // Wurzel, statt sie stillschweigend zu verlieren.
      const batch =
        ready.length > 0 ? ready : pending.map((t) => ({ ...t, parentId: null }))

      for (const task of batch) {
        const created = await this.createTask({
          listId: listIds.get(task.listId)!,
          parentId: task.parentId ? (taskIds.get(task.parentId) ?? null) : null,
          title: task.title,
          notes: task.notes,
          dueAt: task.dueAt,
          allDay: task.allDay,
          priority: task.priority,
          recurrence: task.recurrence,
          position: task.position,
        })
        taskIds.set(task.id, created.id)
        if (task.done) await this.updateTask(created.id, { done: true })
        inserted++
      }

      const handled = new Set(batch.map((t) => t.id))
      pending = pending.filter((t) => !handled.has(t.id))
    }

    return { lists: listIds.size, tasks: inserted }
  }

  // -------------------------------------------------------------- Live-Sync

  subscribeToList(listId: string, onChange: () => void): () => void {
    const channel = this.sb
      .channel(`list:${listId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `list_id=eq.${listId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lists', filter: `id=eq.${listId}` },
        onChange,
      )
      .subscribe()

    return () => {
      void this.sb.removeChannel(channel)
    }
  }
}
