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
  Task,
  TaskPatch,
} from './types'

/**
 * Die einzige Schnittstelle, ueber die die UI an Daten kommt.
 *
 * Warum die Extraschicht statt direkter Supabase-Aufrufe in den Komponenten?
 * Weil der Sync-Ansatz sich mit ziemlicher Sicherheit noch aendert:
 *
 *   heute   LocalRepository     - IndexedDB, ein Geraet, kein Login
 *   naechst SupabaseRepository  - online, geteilte Listen, Realtime
 *   spaeter PowerSyncRepository - lokales SQLite + echter Offline-Schreibpfad
 *   evtl.   eigener Server      - dieselbe API, anderer Endpunkt
 *
 * Solange alle vier dieses Interface erfuellen, ist so ein Wechsel ein
 * Austausch einer Datei - und kein Umbau der halben App.
 *
 * Konvention: Loeschen ist immer Soft-Delete (deleted_at setzen). Ein Client,
 * der eine Zeile nicht mehr sieht, kann sonst nicht unterscheiden, ob sie
 * geloescht wurde oder er sie nur noch nicht kennt.
 */
export interface Repository {
  /** Fuer Diagnose und UI-Hinweise ("laeuft lokal, nicht synchronisiert"). */
  readonly kind: 'local' | 'supabase'

  /** Erlaubt die aktuelle Umgebung geteilte Listen? Im Local-Modus nein. */
  readonly supportsSharing: boolean

  /** ID des angemeldeten Nutzers; im Local-Modus eine feste Geraete-ID. */
  currentUserId(): string

  // ------------------------------------------------------------------ Listen

  getLists(): Promise<List[]>
  createList(input: NewList): Promise<List>
  updateList(id: string, patch: ListPatch): Promise<List>
  /** Soft-Delete: die Liste und alles darin verschwindet aus den Abfragen. */
  deleteList(id: string): Promise<void>

  // ----------------------------------------------------------------- Aufgaben

  /** Flache Liste; den Baum baut die UI daraus (siehe data/tree.ts). */
  getTasks(listId: string): Promise<Task[]>
  /** Alle Aufgaben ueber alle sichtbaren Listen - fuer Startseite und Suche. */
  getAllTasks(): Promise<Task[]>
  createTask(input: NewTask): Promise<Task>
  updateTask(id: string, patch: TaskPatch): Promise<Task>
  /**
   * Soft-Delete inklusive aller Unterpunkte. Rueckgabe sind die betroffenen
   * IDs - genau die braucht `restoreTasks`, damit "Rueckgaengig" den ganzen
   * Teilbaum zurueckholt und nicht nur die angeklickte Zeile.
   */
  deleteTask(id: string): Promise<string[]>
  /** Macht ein deleteTask rueckgaengig. */
  restoreTasks(ids: string[]): Promise<void>

  /**
   * Offene Aufgaben, die bis einschliesslich `through` faellig sind.
   * Basis fuer die Heute-Ansicht und spaeter fuer das Android-Widget.
   */
  getDueTasks(through: IsoDate): Promise<Task[]>

  // ----------------------------------------------------------------- Teilen

  getMembers(listId: string): Promise<ListMember[]>
  getInvites(listId: string): Promise<ListInvite[]>
  inviteToList(listId: string, email: string, role: MemberRole): Promise<ListInvite>
  revokeInvite(inviteId: string): Promise<void>
  /** Gibt die list_id der beigetretenen Liste zurueck. */
  acceptInvite(token: string): Promise<string>
  removeMember(listId: string, userId: string): Promise<void>
  changeMemberRole(listId: string, userId: string, role: MemberRole): Promise<void>
  /** Sich selbst aus einer geteilten Liste austragen. */
  leaveList(listId: string): Promise<void>

  // ---------------------------------------------------------- Export / Import

  exportAll(): Promise<PlannerBackup>
  importBackup(backup: PlannerBackup): Promise<{ lists: number; tasks: number }>

  // -------------------------------------------------------------- Live-Sync

  /**
   * Meldet Fremdaenderungen an ALLEN sichtbaren Listen. Rueckgabe ist die
   * Abmeldefunktion. Implementierungen ohne Live-Sync geben eine no-op
   * zurueck - die UI muss das nicht wissen.
   *
   * Bewusst nicht "nur die geoeffnete Liste": Das Menueleisten-Panel zeigt
   * listenuebergreifend, was heute ansteht, und hat gar keine geoeffnete
   * Liste. Ein Abo je Liste haette dort nichts zu abonnieren - Aenderungen
   * anderer Geraete kaemen erst beim naechsten Refetch an.
   *
   * Was RLS nicht durchlaesst, kommt hier auch nicht an: Postgres Changes
   * filtert serverseitig nach denselben Policies.
   */
  subscribeToAll(onChange: () => void): () => void
}
