import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, LogOut, Monitor, Moon, Sun, Upload } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthProvider'
import { useRepository } from '@/data/RepositoryProvider'
import type { PlannerBackup } from '@/data/types'
import { useTheme, type Theme } from '@/app/theme'
import { isTauri, osName, type OsName } from '@/lib/platform'
import { Dialog } from '@/ui/Dialog'

const OS_LABEL: Record<OsName, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  unknown: 'unbekanntes System',
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setTheme } = useTheme()
  const auth = useAuth()
  const repo = useRepository()
  const qc = useQueryClient()

  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const exportBackup = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const backup = await repo.exportAll()
      const stamp = new Date().toISOString().slice(0, 10)
      downloadJson(`planner-export-${stamp}.json`, backup)
      setStatus(
        `${backup.lists.length} Listen und ${backup.tasks.length} Aufgaben exportiert.`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const importBackup = async (file: File) => {
    setBusy(true)
    setStatus(null)
    try {
      const parsed = JSON.parse(await file.text()) as PlannerBackup
      if (parsed.version !== 1 || !Array.isArray(parsed.lists)) {
        throw new Error('Das sieht nicht nach einem Planner-Export aus.')
      }
      const result = await repo.importBackup(parsed)
      await qc.invalidateQueries()
      setStatus(`${result.lists} Listen und ${result.tasks} Aufgaben importiert.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Einstellungen">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Darstellung
        </h3>
        <div className="flex gap-1 rounded-lg bg-sunken p-1">
          {(
            [
              ['light', 'Hell', Sun],
              ['dark', 'Dunkel', Moon],
              ['system', 'System', Monitor],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => setTheme(value as Theme)}
              className={clsx(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                theme === value
                  ? 'bg-panel font-medium text-ink shadow-sm'
                  : 'text-muted hover:text-ink',
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Daten
        </h3>
        <div className="flex gap-2">
          <button className="btn-outline flex-1" onClick={exportBackup} disabled={busy}>
            <Download size={14} />
            Exportieren
          </button>
          <button
            className="btn-outline flex-1"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload size={14} />
            Importieren
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importBackup(file)
          }}
        />
        <p className="mt-2 text-xs text-muted">
          Der Export ist reines JSON und enthält alles: Listen und Aufgaben samt
          Unterpunkten, Fälligkeiten und Prioritäten. Der Import legt Kopien an
          und überschreibt nie Vorhandenes.
        </p>
      </section>

      <section className="mt-5 border-t border-subtle pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Konto
        </h3>
        {repo.kind === 'local' ? (
          <p className="text-sm text-muted">
            Lokaler Modus — alle Daten liegen nur auf diesem Gerät (
            {OS_LABEL[osName]}, {isTauri ? 'App' : 'Browser'}). Für geteilte
            Listen und Sync zwischen Geräten ein Supabase-Projekt anlegen,
            siehe README.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-muted">{auth.email}</span>
            <button
              className="btn-outline"
              onClick={() => {
                void auth.signOut().then(() => qc.clear())
              }}
            >
              <LogOut size={14} />
              Abmelden
            </button>
          </div>
        )}
      </section>

      {status && <p className="mt-4 text-sm text-accent-600">{status}</p>}
    </Dialog>
  )
}

/**
 * Speichert das Backup als Datei.
 *
 * In Tauri kann die WebView einen Blob-Download je nach Plattform blockieren.
 * Sobald das stoert, ist der Weg tauri-plugin-dialog (Speichern-unter) plus
 * tauri-plugin-fs - dann ohne Anker-Trick.
 */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  // Erst freigeben, wenn der Download angestossen wurde.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
