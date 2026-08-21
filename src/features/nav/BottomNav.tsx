import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { CalendarCheck, Home, Inbox, ListTodo } from 'lucide-react'
import clsx from 'clsx'
import { useAllTasks } from '@/data/hooks'
import { addDaysIso, isOverdue, toIsoDate, todayIso } from '@/lib/date'

/**
 * Navigation am unteren Rand — nur auf schmalen Bildschirmen.
 *
 * Vorher führte der Weg zu jeder anderen Ansicht über ein Hamburger-Menü oben
 * links. Das ist die Ecke, die ein Daumen am schlechtesten erreicht: Wer das
 * Telefon in einer Hand hält, muss es umgreifen. Und es kostete zwei Griffe -
 * aufklappen, auswählen - für etwas, das der häufigste Handgriff überhaupt ist.
 *
 * Hier stehen dieselben Ziele nebeneinander in Daumenreichweite, jedes ein
 * einziger Tipp. Die Listen bleiben hinter der ausfahrbaren Leiste, weil es
 * beliebig viele sein können; die drei festen Ansichten nicht.
 *
 * Ab `md` verschwindet die Leiste — dort steht die Seitenleiste dauerhaft
 * offen, und zwei Navigationen nebeneinander wären eine zu viel.
 */
export function BottomNav({
  onOpenLists,
  listsOpen,
}: {
  onOpenLists: () => void
  listsOpen: boolean
}) {
  const { data: tasks = [] } = useAllTasks()
  const location = useLocation()

  // Dieselbe Rechnung wie in der Seitenleiste, aus derselben Abfrage. Die
  // liegt im Zwischenspeicher, kostet hier also keinen weiteren Zugriff.
  const today = todayIso()
  const weekEnd = addDaysIso(today, 6)
  const open = tasks.filter((t) => !t.done && t.dueAt !== null)
  const dueToday = open.filter((t) => toIsoDate(new Date(t.dueAt!)) <= today).length
  const dueWeek = open.filter((t) => toIsoDate(new Date(t.dueAt!)) <= weekEnd).length
  const overdue = open.filter((t) => isOverdue(t.dueAt)).length

  return (
    <nav
      className={clsx(
        'flex shrink-0 items-stretch border-t border-subtle bg-panel md:hidden',
        // Die Leiste reicht in den Bereich der Gestenleiste hinein und polstert
        // ihren Inhalt wieder heraus. Ohne das endete die Flaeche oberhalb der
        // Gestenleiste, und darunter bliebe ein andersfarbiger Streifen in der
        // Hintergrundfarbe des <body> stehen.
        'mb-[calc(-1*env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)]',
      )}
      aria-label="Hauptnavigation"
    >
      <Tab to="/" end icon={<Home size={20} />} label="Übersicht" />
      <Tab
        to="/heute"
        icon={<CalendarCheck size={20} />}
        label="Heute"
        count={dueToday}
        urgent={overdue > 0}
      />
      <Tab to="/demnaechst" icon={<Inbox size={20} />} label="Demnächst" count={dueWeek} />

      {/*
        Kein NavLink: Die Listen sind kein Ziel, sondern eine Auswahl. Aktiv
        ist der Knopf trotzdem, solange eine Liste offen ist - sonst zeigte die
        Leiste beim Lesen einer Liste auf keinen einzigen Punkt, und man wüsste
        nicht mehr, wo man ist.
      */}
      <Tab
        onClick={onOpenLists}
        active={listsOpen || location.pathname.startsWith('/list/')}
        icon={<ListTodo size={20} />}
        label="Listen"
      />
    </nav>
  )
}

function Tab({
  to,
  end,
  onClick,
  active,
  icon,
  label,
  count,
  urgent,
}: {
  to?: string
  end?: boolean
  onClick?: () => void
  active?: boolean
  icon: ReactNode
  label: string
  count?: number
  urgent?: boolean
}) {
  const inner = (isActive: boolean) => (
    <>
      <span className="relative">
        {icon}
        {count !== undefined && count > 0 && (
          <span
            className={clsx(
              'absolute -right-2.5 -top-1 min-w-4 rounded-full px-1 text-[10px] font-semibold leading-4 tabular-nums',
              urgent
                ? 'bg-red-600 text-white'
                : 'bg-sunken text-muted',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className={clsx('text-[11px]', isActive ? 'font-semibold' : 'font-medium')}>
        {label}
      </span>
    </>
  )

  // Die Trefferfläche ist die ganze Spalte, nicht nur das Symbol: gut 56 Pixel
  // hoch und ein Viertel der Bildschirmbreite. Android empfiehlt 48.
  const shape =
    'flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors'

  if (to) {
    return (
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          clsx(shape, isActive ? 'text-accent-700 dark:text-accent-300' : 'text-muted')
        }
      >
        {({ isActive }) => inner(isActive)}
      </NavLink>
    )
  }

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(shape, active ? 'text-accent-700 dark:text-accent-300' : 'text-muted')}
    >
      {inner(!!active)}
    </button>
  )
}
