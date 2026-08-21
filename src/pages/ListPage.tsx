import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Palette, Share2, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useDeleteList, useLists, useTasks, useUpdateList } from '@/data/hooks'
import { useRepository } from '@/data/RepositoryProvider'
import { LIST_COLORS, listColor } from '@/features/lists/listColors'
import { ShareDialog } from '@/features/share/ShareDialog'
import { TaskView } from '@/features/tasks/TaskView'

export function ListPage() {
  const { listId = '' } = useParams()
  const navigate = useNavigate()
  const repo = useRepository()

  const { data: lists = [], isLoading } = useLists()
  const { data: tasks = [] } = useTasks(listId)
  const updateList = useUpdateList()
  const deleteList = useDeleteList()

  const list = lists.find((l) => l.id === listId)

  const [name, setName] = useState(list?.name ?? '')
  const [syncedName, setSyncedName] = useState(list?.name ?? '')
  const [sharing, setSharing] = useState(false)
  const [pickingColor, setPickingColor] = useState(false)

  // Entwurf nachziehen, wenn sich der Name auf dem Server geaendert hat.
  //
  // Bewusst waehrend des Renders statt in einem useEffect: der Effekt liefe
  // nach jedem Refetch und wuerde den Namen auch dann zuruecksetzen, wenn
  // sich nichts geaendert hat - man tippt, ein Hintergrund-Refetch kommt
  // zurueck, und der halb geschriebene Name ist weg. Der Vergleich mit
  // syncedName reagiert dagegen nur auf echte Aenderungen.
  if (list && list.name !== syncedName) {
    setSyncedName(list.name)
    setName(list.name)
  }

  if (isLoading) {
    return <p className="px-8 py-8 text-sm text-muted">Lädt …</p>
  }

  if (!list) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-12 text-center sm:px-8">
        <p className="text-sm text-muted">
          Diese Liste gibt es nicht (mehr) — oder sie wurde nicht mit dir geteilt.
        </p>
        <Link to="/" className="btn-outline mt-5">
          <ArrowLeft size={15} />
          Zur Übersicht
        </Link>
      </div>
    )
  }

  const accent = listColor(list.color)
  const done = tasks.filter((t) => t.done).length
  const open = tasks.length - done

  const commitName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== list.name) {
      updateList.mutate({ id: list.id, patch: { name: trimmed } })
    } else if (!trimmed) {
      setName(list.name)
    }
  }

  const removeList = () => {
    if (!confirm(`„${list.name}“ mit allen Aufgaben löschen?`)) return
    deleteList.mutate(list.id, { onSuccess: () => void navigate('/') })
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      {/*
        Der farbige Kopf greift die Kachel der Übersicht auf — man sieht
        sofort, in welcher Liste man gelandet ist.

        Auf schmalen Schirmen wird daraus ein Band über die volle Breite: Die
        negativen Ränder heben die Polsterung der Seite auf, die Ecken werden
        eckig. Ein Kasten mit Luft ringsum sieht auf einem Telefon aus wie ein
        Fenster in einer Seite; ein Band sieht aus wie der Kopf der App.
      */}
      <header
        className="tile mb-4 gap-0 max-sm:-mx-5 max-sm:-mt-6 max-sm:rounded-none max-sm:px-5 max-sm:pt-7"
        style={{ '--tile-color': accent } as CSSProperties}
      >
        <div className="flex items-start gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setName(list.name)
                e.currentTarget.blur()
              }
            }}
            className="-ml-1 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-screen font-bold tracking-tight outline-none placeholder:text-white/50 hover:bg-white/10 focus:bg-white/15"
            aria-label="Listenname"
          />

          <HeaderAction
            label="Farbe ändern"
            onClick={() => setPickingColor((v) => !v)}
            active={pickingColor}
          >
            <Palette size={16} />
          </HeaderAction>

          {repo.supportsSharing && (
            <HeaderAction label="Liste teilen" onClick={() => setSharing(true)}>
              <Share2 size={16} />
            </HeaderAction>
          )}

          <HeaderAction label="Liste löschen" onClick={removeList}>
            <Trash2 size={16} />
          </HeaderAction>
        </div>

        <p className="mt-1 px-0.5 text-meta opacity-85 tabular-nums">
          {tasks.length === 0
            ? 'noch leer'
            : `${open} offen · ${done} von ${tasks.length} erledigt`}
        </p>

        {pickingColor && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/20 pt-4">
            {LIST_COLORS.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  updateList.mutate({ id: list.id, patch: { color: option.value } })
                  setPickingColor(false)
                }}
                className={clsx(
                  'flex size-8 items-center justify-center rounded-lg ring-white/70 transition-all',
                  accent === option.value ? 'ring-2' : 'hover:ring-2',
                )}
                style={{ backgroundColor: option.value }}
                aria-label={option.name}
                title={option.name}
              >
                {accent === option.value && <Check size={14} strokeWidth={3} />}
              </button>
            ))}
          </div>
        )}
      </header>

      <TaskView listId={list.id} accent={accent} />

      <ShareDialog list={list} open={sharing} onClose={() => setSharing(false)} />
    </div>
  )
}

function HeaderAction({
  children,
  label,
  onClick,
  active,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        'shrink-0 rounded-lg p-2 transition-colors',
        active ? 'bg-white/25' : 'hover:bg-white/15',
      )}
    >
      {children}
    </button>
  )
}
