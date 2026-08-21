import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Dialog auf Basis des nativen <dialog>-Elements.
 *
 * showModal() bringt Fokusfalle, Escape-Handling, inert-Hintergrund und die
 * ::backdrop-Ebene mit - alles Dinge, die man sich sonst aus einer Bibliothek
 * holt oder falsch nachbaut.
 *
 * Auf schmalen Bildschirmen wird daraus ein Bottom Sheet: Es klebt am unteren
 * Rand, geht über die volle Breite und ist oben abgerundet. Das ist nicht nur
 * Geschmack - ein mittig schwebendes Kästchen zwingt den Daumen in die
 * Bildschirmmitte, während unten alles in Reichweite liegt. Und wenn die
 * Tastatur aufgeht, schiebt sich ein am Boden verankerter Dialog mit hoch,
 * statt dahinter zu verschwinden.
 *
 * Der Umbau steckt komplett in CSS-Klassen. Dadurch bekommt ihn jeder Dialog
 * der App geschenkt - Einstellungen, Teilen, Neue Liste - ohne dass eine
 * einzige Stelle davon wissen müsste.
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
      // `open:flex` und nicht `flex`: Ein geschlossenes <dialog> ist nur
      // deshalb unsichtbar, weil das Browser-Stylesheet ihm display:none gibt.
      // Diese Regel stammt aus dem UA-Ursprung, und JEDE Autorenregel schlaegt
      // sie - unabhaengig von der Spezifitaet. Ein schlichtes `flex` machte
      // damit aus jedem Dialog der App ein Element, das dauerhaft mitten auf
      // der Seite steht. Der open:-Variant greift erst, wenn das Attribut da
      // ist, und laesst dem Browser vorher seinen Willen.
      className="sheet panel open:flex max-h-[85dvh] flex-col p-0 text-ink
                 backdrop:bg-black/40 backdrop:backdrop-blur-[2px]
                 m-auto w-[min(30rem,calc(100vw-2rem))]
                 max-md:mx-0 max-md:mb-0 max-md:mt-auto max-md:w-full
                 max-md:rounded-b-none"
    >
      {/* Griff. Nur auf dem Telefon, und nur als Zeichen: Er sagt „von unten
          hereingefahren, hier wieder weg" - dieselbe Sprache, die jede
          Android-App spricht. Gezogen wird nicht daran; dafür gibt es den
          Backdrop und die Zurück-Geste. */}
      <div className="flex justify-center pt-2.5 md:hidden" aria-hidden>
        <span className="h-1 w-9 rounded-full bg-muted/35" />
      </div>

      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-subtle px-5 py-4 max-md:pt-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {/* Auf dem Telefon führt der Weg hinaus über Backdrop, Zurück-Geste
            und Griff - das X kostet dort nur Platz in der Kopfzeile. */}
        <button
          onClick={onClose}
          className="btn-ghost -mr-2 -mt-1 px-2 max-md:hidden"
          aria-label="Schließen"
        >
          <X size={18} />
        </button>
      </div>

      {/* Der scrollende Teil. Ohne min-h-0 wächst ein Flex-Kind über seinen
          Container hinaus, statt zu scrollen - dann läge der Fußbereich
          unerreichbar unterhalb des Bildschirms. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer && (
        <div
          className="flex shrink-0 justify-end gap-2 border-t border-subtle px-5 py-3
                     max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {footer}
        </div>
      )}

      {/* Ohne Fußbereich endet das Sheet direkt an der Gestenleiste. Das
          Polster steht hier und nicht am <dialog>: Das Element liegt in der
          Top-Layer, wo das safe-area-Polster des <body> nicht mehr gilt. */}
      {!footer && (
        <div className="shrink-0 pb-[env(safe-area-inset-bottom)] md:hidden" aria-hidden />
      )}
    </dialog>
  )
}
