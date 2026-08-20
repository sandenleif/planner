import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useToastStore, type Toast } from './toast'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
      role="status"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <ToastRow key={item.id} toast={item} />
      ))}
    </div>
  )
}

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, dismiss])

  return (
    <div
      className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-subtle bg-panel px-4 py-3 shadow-[var(--shadow-tile)]"
      style={{ animation: 'toast-in 180ms cubic-bezier(0.2, 0, 0.2, 1)' }}
    >
      <span className="min-w-0 flex-1 text-sm">{toast.message}</span>

      {toast.action && (
        <button
          onClick={() => {
            toast.action?.run()
            dismiss(toast.id)
          }}
          className="shrink-0 rounded-lg px-2.5 py-1 text-sm font-semibold text-accent-700 transition-colors hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-900/40"
        >
          {toast.action.label}
        </button>
      )}

      <button
        onClick={() => dismiss(toast.id)}
        className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-hover hover:text-ink"
        aria-label="Meldung schließen"
      >
        <X size={14} />
      </button>
    </div>
  )
}
