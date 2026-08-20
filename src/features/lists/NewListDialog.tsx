import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import clsx from 'clsx'
import { useCreateList } from '@/data/hooks'
import { Dialog } from '@/ui/Dialog'
import { DEFAULT_LIST_COLOR, LIST_COLORS } from './listColors'

export function NewListDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(DEFAULT_LIST_COLOR)
  const createList = useCreateList()
  const navigate = useNavigate()

  const close = () => {
    setName('')
    setColor(DEFAULT_LIST_COLOR)
    createList.reset()
    onClose()
  }

  const submit = async () => {
    if (!name.trim()) return
    const list = await createList.mutateAsync({ name, color })
    close()
    // Direkt in die neue Liste springen - wer eine Liste anlegt, will etwas
    // hineinschreiben, nicht die Übersicht bewundern.
    void navigate(`/list/${list.id}`)
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Neue Liste"
      footer={
        <>
          <button className="btn-ghost" onClick={close}>
            Abbrechen
          </button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={!name.trim() || createList.isPending}
          >
            Anlegen
          </button>
        </>
      }
    >
      <input
        className="field"
        placeholder="z. B. Einkaufen, Arbeit, Urlaub"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />

      <fieldset className="mt-5">
        <legend className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted">
          Farbe
        </legend>
        <div className="flex flex-wrap gap-2.5">
          {LIST_COLORS.map((option) => (
            <button
              key={option.value}
              onClick={() => setColor(option.value)}
              className={clsx(
                'flex size-9 items-center justify-center rounded-xl text-white transition-transform',
                color === option.value && 'ring-2 ring-ink ring-offset-2 ring-offset-panel',
              )}
              style={{ backgroundColor: option.value }}
              aria-label={option.name}
              title={option.name}
              aria-pressed={color === option.value}
            >
              {color === option.value && <Check size={16} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </fieldset>

      {createList.isError && (
        <p className="mt-4 text-sm text-red-600">{createList.error.message}</p>
      )}
    </Dialog>
  )
}
