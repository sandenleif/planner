import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Dialog auf Basis des nativen <dialog>-Elements.
 *
 * showModal() bringt Fokusfalle, Escape-Handling, inert-Hintergrund und die
 * ::backdrop-Ebene mit - alles Dinge, die man sich sonst aus einer Bibliothek
 * holt oder falsch nachbaut.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Klick auf den Backdrop schliesst. Das Element selbst faengt den Klick
      // nur, wenn er ausserhalb des Inhalts landet - daher der Vergleich.
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      className="panel m-auto w-[min(30rem,calc(100vw-2rem))] p-0 text-ink
                 backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        <button onClick={onClose} className="btn-ghost -mr-2 -mt-1 px-2" aria-label="Schließen">
          <X size={18} />
        </button>
      </div>

      <div className="px-5 py-4">{children}</div>

      {footer && (
        <div className="flex justify-end gap-2 border-t border-subtle px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  )
}
