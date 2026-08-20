import { useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAcceptInvite } from '@/data/hooks'
import { useAuth } from '@/auth/AuthProvider'

/**
 * Einladungslink einlösen: /#/invite/<token>
 *
 * Der Token wird nicht im Client geprueft, sondern an die RPC
 * accept_list_invite() gereicht. Nur die kennt die Regeln (abgelaufen?
 * schon benutzt? richtige E-Mail?) und kann sie auch durchsetzen.
 */
export function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const auth = useAuth()
  const accept = useAcceptInvite()
  const tried = useRef(false)

  useEffect(() => {
    if (!token || auth.loading || !auth.userId || tried.current) return
    tried.current = true

    accept.mutate(token, {
      onSuccess: (listId) => navigate(`/list/${listId}`, { replace: true }),
    })
  }, [token, auth.loading, auth.userId, accept, navigate])

  return (
    <div className="mx-auto w-full max-w-md px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Einladung</h1>

      {auth.loading && <p className="mt-3 text-sm text-muted">Einen Moment …</p>}

      {!auth.loading && !auth.userId && (
        <p className="mt-3 text-sm text-muted">
          Melde dich zuerst mit der E-Mail-Adresse an, an die die Einladung ging.
          Danach diesen Link erneut öffnen.
        </p>
      )}

      {accept.isPending && <p className="mt-3 text-sm text-muted">Liste wird geöffnet …</p>}

      {accept.isError && (
        <>
          <p className="mt-3 text-sm text-red-500">{accept.error.message}</p>
          <Link to="/" className="btn-outline mt-5">
            Zurück zur Übersicht
          </Link>
        </>
      )}
    </div>
  )
}
