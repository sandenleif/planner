import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { CalendarCheck, Home, Inbox, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAllTasks, useLists } from '@/data/hooks'
import type { List } from '@/data/types'
import { addDaysIso, isOverdue, toIsoDate, todayIso } from '@/lib/date'
import { sortByPosition } from '@/lib/ordering'
import { listColor } from './listColors'
import { NewListDialog } from './NewListDialog'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: lists = [], isLoading } = useLists()
  const { data: tasks = [] } = useAllTasks()
  const [creating, setCreating] = useState(false)

  // Offene Aufgaben je Liste - dieselbe Abfrage, die auch die Kacheln speist,
  // also kostet die Zahl hier keinen zusätzlichen Roundtrip.
  const openCounts = new Map<string, number>()
  for (const task of tasks) {
    if (task.done) continue
    openCounts.set(task.listId, (openCounts.get(task.listId) ?? 0) + 1)
  }

  const today = todayIso()
  const weekEnd = addDaysIso(today, 6)
  const open = tasks.filter((t) => !t.done && t.dueAt !== null)
  const dueToday = open.filter((t) => toIsoDate(new Date(t.dueAt!)) <= today).length
  const dueWeek = open.filter((t) => toIsoDate(new Date(t.dueAt!)) <= weekEnd).length
  const overdue = open.filter((t) => isOverdue(t.dueAt)).length

  return (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 py-3">
      <NavLink to="/" onClick={onNavigate} end className={({ isActive }) => navClass(isActive)}>
        <Home size={16} className="shrink-0" />
        <span className="flex-1 truncate">Übersicht</span>
      </NavLink>

      <NavLink to="/heute" onClick={onNavigate} className={({ isActive }) => navClass(isActive)}>
        <CalendarCheck size={16} className="shrink-0" />
        <span className="flex-1 truncate">Heute</span>
        {dueToday > 0 && (
          <span
            className={clsx(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
              // Überfälliges soll auffallen, ohne dass man erst hinklickt.
              overdue > 0 ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'text-muted',
            )}
          >
            {dueToday}
          </span>
        )}
      </NavLink>

      <NavLink
        to="/demnaechst"
        onClick={onNavigate}
        className={({ isActive }) => navClass(isActive)}
      >
        <Inbox size={16} className="shrink-0" />
        <span className="flex-1 truncate">Demnächst</span>
        {dueWeek > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted">{dueWeek}</span>
        )}
      </NavLink>

      <div className="mt-5 flex items-center justify-between px-3 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Listen
        </span>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md p-0.5 text-muted transition-colors hover:bg-hover hover:text-ink"
          aria-label="Neue Liste"
          title="Neue Liste"
        >
          <Plus size={15} />
        </button>
      </div>

      {lists.length === 0 && !isLoading && (
        <p className="px-3 py-1 text-xs italic text-muted">Noch keine Liste</p>
      )}

      {sortByPosition(lists).map((list) => (
        <ListLink
          key={list.id}
          list={list}
          open={openCounts.get(list.id) ?? 0}
          onNavigate={onNavigate}
        />
      ))}

      <NewListDialog open={creating} onClose={() => setCreating(false)} />
    </nav>
  )
}

function navClass(isActive: boolean) {
  return clsx(
    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-hover font-medium text-ink'
      : 'text-muted hover:bg-hover hover:text-ink',
  )
}

function ListLink({
  list,
  open,
  onNavigate,
}: {
  list: List
  open: number
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={`/list/${list.id}`}
      onClick={onNavigate}
      className={({ isActive }) => navClass(isActive)}
    >
      <span
        className="size-3 shrink-0 rounded-[5px]"
        style={{ backgroundColor: listColor(list.color) }}
      />
      <span className="min-w-0 flex-1 truncate">{list.name}</span>
      {open > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted">{open}</span>
      )}
    </NavLink>
  )
}
