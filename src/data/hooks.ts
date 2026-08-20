import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { newId } from '@/lib/id'
import { todayIso } from '@/lib/date'
import { toast } from '@/ui/toast'
import { nextOccurrence } from './recurrence'
import { useRepository } from './RepositoryProvider'
import type {
  IsoDate,
  List,
  ListPatch,
  MemberRole,
  NewList,
  NewTask,
  Recurrence,
  Task,
  TaskPatch,
} from './types'

/**
 * TanStack Query als Cache- und Sync-Schicht.
 *
 * Zwei Dinge sind hier Absicht:
 *
 * 1. Jede schreibende Aktion ist optimistisch. Ein Haken, der erst nach dem
 *    Netzwerk-Roundtrip umspringt, fuehlt sich kaputt an - besonders auf
 *    Android im Zug. Der Cache wird sofort veraendert, bei Fehler
 *    zurueckgerollt.
 *
 * 2. Kein Hook spricht direkt mit Supabase, sondern nur mit dem Repository.
 *    Deshalb funktioniert dieselbe Datei unveraendert im Local-Modus.
 */

export const qk = {
  lists: ['lists'] as const,
  tasks: (listId: string) => ['tasks', listId] as const,
  allTasks: ['allTasks'] as const,
  due: (through: string) => ['due', through] as const,
  members: (listId: string) => ['members', listId] as const,
  invites: (listId: string) => ['invites', listId] as const,
}

/** Nach jeder Aufgaben-Mutation: die listenuebergreifenden Abfragen sind stale. */
function invalidateDerived(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.allTasks })
  void qc.invalidateQueries({ queryKey: ['due'] })
}

interface TaskSnapshot {
  list: Task[] | undefined
  all: Task[] | undefined
}

/**
 * Wendet eine optimistische Aenderung auf BEIDE Aufgaben-Caches an: die
 * Abfrage der einen Liste und die listenuebergreifende.
 *
 * Der Grund ist das Menueleisten-Panel. Es liest `allTasks` - eine geoeffnete
 * Liste hat es nicht. Fasste eine Mutation wie bisher nur `tasks(listId)` an,
 * spraenge der Haken dort erst nach dem Roundtrip um. Ausgerechnet an der
 * Stelle, die man fuer genau diesen einen Handgriff aufklappt, saehe die App
 * damit am langsamsten aus.
 *
 * Ein Cache, den es noch nicht gibt, bleibt leer: `undefined` heisst "nie
 * geladen". Ihn mit einer einzelnen Zeile zu fuellen ergaebe eine Liste, die
 * so nie existiert hat.
 *
 * Rueckgabe ist der Zustand von vorher - fuer den Rollback im Fehlerfall.
 */
function patchTaskCaches(
  qc: QueryClient,
  listId: string,
  update: (tasks: Task[]) => Task[],
): TaskSnapshot {
  const previous: TaskSnapshot = {
    list: qc.getQueryData<Task[]>(qk.tasks(listId)),
    all: qc.getQueryData<Task[]>(qk.allTasks),
  }

  qc.setQueryData<Task[]>(qk.tasks(listId), (old) => (old ? update(old) : old))
  qc.setQueryData<Task[]>(qk.allTasks, (old) => (old ? update(old) : old))

  return previous
}

function restoreTaskCaches(qc: QueryClient, listId: string, previous: TaskSnapshot) {
  if (previous.list) qc.setQueryData(qk.tasks(listId), previous.list)
  if (previous.all) qc.setQueryData(qk.allTasks, previous.all)
}

/**
 * Die bereits bekannten Geschwister einer Liste - egal, welche Abfrage sie
 * gerade im Cache hat.
 *
 * Wird fuer die Position einer neuen Aufgabe gebraucht (Fractional Index).
 * Im Panel ist `tasks(listId)` nie geladen; ohne den Rueckgriff auf
 * `allTasks` rechnete jede dort angelegte Aufgabe ihre Position gegen eine
 * leere Liste - und alle bekaemen dieselbe.
 */
function knownSiblings(qc: QueryClient, listId: string): Task[] {
  const fromList = qc.getQueryData<Task[]>(qk.tasks(listId))
  if (fromList) return fromList

  const fromAll = qc.getQueryData<Task[]>(qk.allTasks) ?? []
  return fromAll.filter((task) => task.listId === listId)
}

// ---------------------------------------------------------------------- Listen

export function useLists() {
  const repo = useRepository()
  return useQuery({
    queryKey: qk.lists,
    queryFn: () => repo.getLists(),
  })
}

export function useCreateList() {
  const repo = useRepository()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewList) => repo.createList(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.lists }),
  })
}

export function useUpdateList() {
  const repo = useRepository()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ListPatch }) =>
      repo.updateList(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.lists })
      const previous = qc.getQueryData<List[]>(qk.lists)
      qc.setQueryData<List[]>(qk.lists, (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.lists, ctx.previous)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.lists }),
  })
}

export function useDeleteList() {
  const repo = useRepository()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repo.deleteList(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.lists })
      const previous = qc.getQueryData<List[]>(qk.lists)
      qc.setQueryData<List[]>(qk.lists, (old) => old?.filter((l) => l.id !== id))
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.lists, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.lists })
      invalidateDerived(qc)
    },
  })
}

// --------------------------------------------------------------------- Tasks

export function useTasks(listId: string | null) {
  const repo = useRepository()
  return useQuery({
    queryKey: qk.tasks(listId ?? ''),
    queryFn: () => repo.getTasks(listId!),
    enabled: listId !== null,
  })
}

/** Alle Aufgaben aller Listen - Grundlage der Kacheln auf der Startseite. */
export function useAllTasks() {
  const repo = useRepository()
  return useQuery({
    queryKey: qk.allTasks,
    queryFn: () => repo.getAllTasks(),
  })
}

export function useDueTasks(through: IsoDate = todayIso()) {
  const repo = useRepository()
  return useQuery({
    queryKey: qk.due(through),
    queryFn: () => repo.getDueTasks(through),
  })
}

export function useCreateTask(listId: string) {
  const repo = useRepository()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (input: Omit<NewTask, 'listId'>) => repo.createTask({ ...input, listId }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.tasks(listId) })
      await qc.cancelQueries({ queryKey: qk.allTasks })

      // Platzhalter mit eigener ID. Wird beim Invalidieren durch die echte
      // Zeile ersetzt; bis dahin ist die Aufgabe sofort sichtbar.
      const optimistic = draftTask(
        listId,
        input,
        repo.currentUserId(),
        knownSiblings(qc, listId),
      )
      const previous = patchTaskCaches(qc, listId, (tasks) => [...tasks, optimistic])

      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) restoreTaskCaches(qc, listId, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.tasks(listId) })
      invalidateDerived(qc)
    },
  })
}

export function useUpdateTask(listId: string) {
  const repo = useRepository()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      repo.updateTask(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.tasks(listId) })
      await qc.cancelQueries({ queryKey: qk.allTasks })

      const previous = patchTaskCaches(qc, listId, (tasks) =>
        tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                completedAt:
                  patch.done === undefined
                    ? t.completedAt
                    : patch.done
                      ? (t.completedAt ?? new Date().toISOString())
                      : null,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) restoreTaskCaches(qc, listId, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.tasks(listId) })
      invalidateDerived(qc)
    },
  })
}

export function useDeleteTask(listId: string) {
  const repo = useRepository()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => repo.deleteTask(id),

    onSuccess: (removedIds) => {
      // Loeschen ohne Sicherheitsabfrage ist nur zumutbar, wenn es einen Weg
      // zurueck gibt. Der Soft-Delete macht das billig: deleted_at leeren.
      const label = removedIds.length > 1 ? `${removedIds.length} Aufgaben` : 'Aufgabe'
      toast.withAction(`${label} gelöscht`, 'Rückgängig', () => {
        void repo.restoreTasks(removedIds).then(() => {
          void qc.invalidateQueries({ queryKey: qk.tasks(listId) })
          invalidateDerived(qc)
        })
      })
    },

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.tasks(listId) })
      await qc.cancelQueries({ queryKey: qk.allTasks })

      // Unterpunkte verschwinden mit - sonst blitzen sie als Waisen auf,
      // bis der Server antwortet.
      const doomed = collectSubtree(knownSiblings(qc, listId), id)
      const previous = patchTaskCaches(qc, listId, (tasks) =>
        tasks.filter((t) => !doomed.has(t.id)),
      )

      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) restoreTaskCaches(qc, listId, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.tasks(listId) })
      invalidateDerived(qc)
    },
  })
}

/**
 * Abhaken - und bei wiederkehrenden Aufgaben gleich die naechste anlegen.
 *
 * Die Regel steht in data/recurrence.ts, nicht hier: so gilt sie unabhaengig
 * davon, ob gerade das Local- oder das Supabase-Repository arbeitet.
 */
export function useToggleTaskDone(listId: string) {
  const repo = useRepository()
  const qc = useQueryClient()
  const updateTask = useUpdateTask(listId)

  return useMutation({
    mutationFn: async (
      task: Task,
    ): Promise<{ repeated: Recurrence | null; nextDue: string | null }> => {
      const done = !task.done
      await repo.updateTask(task.id, { done })

      // Nur beim Abhaken entsteht eine Folgeaufgabe - beim Zuruecknehmen
      // wuerde sonst bei jedem Klick eine weitere Kopie auflaufen.
      if (!done) return { repeated: null, nextDue: null }

      const follow = nextOccurrence(task)
      if (!follow) return { repeated: null, nextDue: null }

      await repo.createTask(follow)
      return { repeated: task.recurrence, nextDue: follow.dueAt ?? null }
    },

    onMutate: (task) => {
      // Der Haken selbst muss sofort umspringen; die Folgeaufgabe darf
      // ruhig einen Wimpernschlag spaeter erscheinen.
      updateTask.mutate({ id: task.id, patch: { done: !task.done } })
    },

    onSuccess: (result) => {
      if (result.repeated && result.nextDue) {
        const when = new Date(result.nextDue).toLocaleDateString('de-DE', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
        toast.show(`Wiederholt sich — nächste Fälligkeit ${when}`)
      }
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.tasks(listId) })
      invalidateDerived(qc)
    },
  })
}

// -------------------------------------------------------------------- Teilen

export function useMembers(listId: string | null) {
  const repo = useRepository()
  return useQuery({
    queryKey: qk.members(listId ?? ''),
    queryFn: () => repo.getMembers(listId!),
    enabled: listId !== null && repo.supportsSharing,
  })
}

export function useInvites(listId: string | null) {
  const repo = useRepository()
  return useQuery({
    queryKey: qk.invites(listId ?? ''),
    queryFn: () => repo.getInvites(listId!),
    enabled: listId !== null && repo.supportsSharing,
  })
}

export function useInviteToList(listId: string) {
  const repo = useRepository()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: MemberRole }) =>
      repo.inviteToList(listId, email, role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.invites(listId) }),
  })
}

export function useRevokeInvite(listId: string) {
  const repo = useRepository()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) => repo.revokeInvite(inviteId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.invites(listId) }),
  })
}

export function useRemoveMember(listId: string) {
  const repo = useRepository()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => repo.removeMember(listId, userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.members(listId) }),
  })
}

export function useAcceptInvite() {
  const repo = useRepository()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => repo.acceptInvite(token),
    onSuccess: () => void qc.invalidateQueries(),
  })
}

// ------------------------------------------------------------------ Live-Sync

/**
 * Abonniert Fremdaenderungen an allen sichtbaren Listen und invalidiert dann
 * die betroffenen Queries. Bewusst grob: neu laden ist bei diesen Datenmengen
 * billiger als das Zusammenfuehren einzelner Events - und deutlich weniger
 * fehleranfaellig.
 *
 * Frueher hing das Abo an der geoeffneten Liste. Damit bekam nur die
 * Listenansicht Fremdaenderungen mit: Startseite, Agenda und das
 * Menueleisten-Panel warteten auf den naechsten Refetch, also bis zu
 * `staleTime` plus Fensterfokus. Genau dort faellt es aber auf - das Panel
 * klappt man auf, um in zwei Sekunden zu sehen, was ansteht.
 *
 * Gehoert je Fenster genau einmal in den Baum. Haupt- und Panel-Fenster sind
 * getrennte WebViews mit getrennten Caches; jedes braucht sein eigenes.
 */
export function useGlobalRealtime() {
  const repo = useRepository()
  const qc = useQueryClient()

  useEffect(
    () =>
      repo.subscribeToAll(() => {
        // Praefix statt einzelnem Schluessel: welche Liste sich geaendert hat,
        // steht im Ereignis, aber danach zu unterscheiden hiesse, die Zeile
        // auszuwerten - und damit genau das Zusammenfuehren zu tun, das dieser
        // Ansatz vermeiden will.
        void qc.invalidateQueries({ queryKey: ['tasks'] })
        void qc.invalidateQueries({ queryKey: qk.lists })
        invalidateDerived(qc)
      }),
    [repo, qc],
  )
}

// ------------------------------------------------------------------- Helfer

function draftTask(
  listId: string,
  input: Omit<NewTask, 'listId'>,
  userId: string,
  existing: readonly Task[],
): Task {
  const stamp = new Date().toISOString()
  const siblings = existing.filter(
    (t) => t.parentId === (input.parentId ?? null) && t.listId === listId,
  )
  // Reine Anzeigeposition. Die endgueltige vergibt das Repository - hier
  // reicht "hinter dem letzten Geschwister".
  const lastPosition = siblings.reduce<string>(
    (max, t) => (t.position.localeCompare(max) > 0 ? t.position : max),
    'a0',
  )

  return {
    id: newId(),
    listId,
    parentId: input.parentId ?? null,
    title: input.title.trim(),
    notes: input.notes ?? null,
    done: false,
    completedAt: null,
    dueAt: input.dueAt ?? null,
    allDay: input.allDay ?? true,
    priority: input.priority ?? null,
    recurrence: input.recurrence ?? null,
    position: input.position ?? `${lastPosition}~`,
    createdBy: userId,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
}

function collectSubtree(tasks: readonly Task[], rootId: string): Set<string> {
  const doomed = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const task of tasks) {
      if (task.parentId && doomed.has(task.parentId) && !doomed.has(task.id)) {
        doomed.add(task.id)
        grew = true
      }
    }
  }
  return doomed
}
