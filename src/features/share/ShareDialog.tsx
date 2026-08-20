import { useState } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import {
  useInvites,
  useInviteToList,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
} from '@/data/hooks'
import { useRepository } from '@/data/RepositoryProvider'
import type { List, MemberRole } from '@/data/types'
import { Dialog } from '@/ui/Dialog'

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Besitzer',
  editor: 'Bearbeiten',
  viewer: 'Nur lesen',
}

export function ShareDialog({
  list,
  open,
  onClose,
}: {
  list: List
  open: boolean
  onClose: () => void
}) {
  const repo = useRepository()
  const me = repo.currentUserId()

  const { data: members = [] } = useMembers(open ? list.id : null)
  const { data: invites = [] } = useInvites(open ? list.id : null)
  const invite = useInviteToList(list.id)
  const revoke = useRevokeInvite(list.id)
  const removeMember = useRemoveMember(list.id)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('editor')

  const iAmOwner = members.some((m) => m.userId === me && m.role === 'owner')

  const submit = async () => {
    if (!email.trim()) return
    await invite.mutateAsync({ email, role })
    setEmail('')
  }

  if (!repo.supportsSharing) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Liste teilen"
        description="Dafür braucht die App ein Backend."
      >
        <p className="text-sm text-muted">
          Im lokalen Modus liegen alle Daten nur auf diesem Gerät. Geteilte Listen
          brauchen ein Supabase-Projekt — die Einrichtung steht in der README unter
          „Supabase einrichten“.
        </p>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`„${list.name}“ teilen`}
      description="Eingeladene sehen die Liste, sobald sie die Einladung annehmen."
    >
      {iAmOwner && (
        <div className="flex gap-2">
          <input
            className="field flex-1"
            type="email"
            inputMode="email"
            placeholder="name@beispiel.de"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <select
            className="field w-auto"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
          >
            <option value="editor">Bearbeiten</option>
            <option value="viewer">Nur lesen</option>
          </select>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={!email.trim() || invite.isPending}
          >
            Einladen
          </button>
        </div>
      )}

      {invite.isError && (
        <p className="mt-2 text-sm text-red-500">{invite.error.message}</p>
      )}

      <section className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Mitglieder
        </h3>
        <ul className="flex flex-col gap-1">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-medium text-accent-700">
                {initials(member.displayName ?? member.email ?? '?')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {member.displayName ?? member.email ?? 'Unbekannt'}
                  {member.userId === me && ' (du)'}
                </span>
                {member.email && member.displayName && (
                  <span className="block truncate text-xs text-muted">{member.email}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted">{ROLE_LABEL[member.role]}</span>
              {iAmOwner && member.userId !== me && (
                <button
                  onClick={() => removeMember.mutate(member.userId)}
                  className="rounded p-1 text-muted hover:bg-sunken hover:text-red-500"
                  aria-label="Mitglied entfernen"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Offene Einladungen
          </h3>
          <ul className="flex flex-col gap-1">
            {invites.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{item.email}</span>
                <span className="shrink-0 text-xs text-muted">{ROLE_LABEL[item.role]}</span>
                <CopyLinkButton token={item.token} />
                <button
                  onClick={() => revoke.mutate(item.id)}
                  className="rounded p-1 text-muted hover:bg-sunken hover:text-red-500"
                  aria-label="Einladung zurückziehen"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Die App verschickt noch keine E-Mails — Link kopieren und selbst schicken.
            Das Versenden wäre später eine Supabase Edge Function.
          </p>
        </section>
      )}
    </Dialog>
  )
}

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const base = import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin
    try {
      await navigator.clipboard.writeText(`${base}/#/invite/${token}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard braucht einen secure context - auf http://<lan-ip> fehlt der.
      prompt('Link kopieren:', `${base}/#/invite/${token}`)
    }
  }

  return (
    <button
      onClick={copy}
      className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
      aria-label="Einladungslink kopieren"
      title="Einladungslink kopieren"
    >
      {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
    </button>
  )
}

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
