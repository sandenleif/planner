import { create } from 'zustand'
import { newId } from '@/lib/id'

/**
 * Kurzmeldungen am unteren Rand, optional mit einer Aktion.
 *
 * Der eigentliche Zweck ist "Rückgängig": Löschen ohne Sicherheitsabfrage
 * fühlt sich nur dann gut an, wenn man es zurücknehmen kann. Eine Abfrage bei
 * jedem Klick wäre der langsamere und lästigere Weg zum selben Schutz.
 */

export interface Toast {
  id: string
  message: string
  action?: { label: string; run: () => void }
  /** Anzeigedauer in ms. */
  duration: number
}

interface ToastState {
  toasts: Toast[]
  push(toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }): string
  dismiss(id: string): void
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  push(toast) {
    const id = newId()
    // Mit Aktion länger stehen lassen - man muss sie ja lesen und treffen.
    const duration = toast.duration ?? (toast.action ? 7000 : 3500)

    set((state) => ({ toasts: [...state.toasts, { ...toast, id, duration }] }))
    return id
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
}))

/** Bequemer Aufruf von ausserhalb einer Komponente (z. B. aus Hooks). */
export const toast = {
  show(message: string, duration?: number) {
    return useToastStore.getState().push({ message, duration })
  },
  withAction(message: string, label: string, run: () => void) {
    return useToastStore.getState().push({ message, action: { label, run } })
  },
  error(message: string) {
    return useToastStore.getState().push({ message, duration: 6000 })
  },
}
