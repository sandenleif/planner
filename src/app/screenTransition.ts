import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { isTouchPrimary } from '@/lib/platform'

/**
 * Bildschirmwechsel mit Richtung — der Unterschied zwischen einer App und
 * einer Webseite in einem Rahmen.
 *
 * Auf einer Webseite tauscht ein Klick den Inhalt schlagartig aus. Eine App
 * schiebt: Wer tiefer geht, sieht den neuen Bildschirm von rechts
 * hereinkommen, während der alte nach links weicht; wer zurückgeht, sieht das
 * Gegenteil. Diese Bewegung ist nicht Zierde — sie sagt einem, wo man ist und
 * wo man herkommt, und macht die Zurück-Geste erst verständlich.
 *
 * # Wie
 *
 * Über die View-Transitions-API des Browsers. Sie fotografiert den alten
 * Zustand, lässt React den neuen rendern und blendet dann zwischen beiden
 * Bildern über — die Animation selbst liegt in index.css. Das ist der einzige
 * Weg, der ohne eine Animationsbibliothek auskommt und trotzdem BEIDE Seiten
 * bewegt: Ohne sie ist der alte Bildschirm bereits weg, wenn der neue da ist.
 *
 * # Woher die Richtung kommt
 *
 * Nicht aus dem Klick, sondern aus der Tiefe der Route. Das ist wichtig, weil
 * die Zurück-Geste auf Android gar keinen Klick auslöst: Sie ruft
 * `history.back()` in der WebView auf, und davon bekommt eine Komponente nur
 * die neue Adresse mit. Über die Tiefe stimmt die Richtung in beiden Fällen.
 *
 * # Nur auf Touch
 *
 * Auf dem Schreibtisch schieben Programme keine Bildschirme herein — dort
 * wäre die Bewegung eine Verzögerung ohne Aussage. Und ohne Unterstützung im
 * Browser oder bei „Bewegung reduzieren" wird schlicht getauscht wie bisher.
 */

/**
 * Wie tief eine Ansicht liegt.
 *
 * Übersicht, Heute und Demnächst sind Geschwister auf Ebene 0 — zwischen
 * ihnen wird geblendet statt geschoben, weil keine über der anderen liegt.
 * Eine Liste liegt darunter.
 */
function depthOf(pathname: string): number {
  if (pathname.startsWith('/list/') || pathname.startsWith('/invite/')) return 1
  return 0
}

export function useScreenTransition(): Location {
  const location = useLocation()
  const [shown, setShown] = useState(location)
  const depth = useRef(depthOf(location.pathname))

  // useLayoutEffect und nicht useEffect: Der Wechsel muss vor dem nächsten
  // Bild angestoßen werden, sonst blitzt der neue Zustand kurz ohne Bewegung
  // auf und die Animation läuft danach ins Leere.
  useLayoutEffect(() => {
    if (shown === location) return

    const next = depthOf(location.pathname)
    const previous = depth.current
    depth.current = next

    const startViewTransition = document.startViewTransition?.bind(document)

    const animate =
      isTouchPrimary &&
      startViewTransition !== undefined &&
      shown.pathname !== location.pathname &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!animate) {
      setShown(location)
      return
    }

    document.documentElement.dataset.nav =
      next > previous ? 'forward' : next < previous ? 'back' : 'same'

    // flushSync ist hier Pflicht, nicht Vorsicht: Der Browser fotografiert den
    // neuen Zustand, sobald dieser Rückruf zurückkehrt. Ein Rendern, das React
    // auf später verschiebt, käme zu spät und würde gar nicht mitfotografiert.
    const transition = startViewTransition(() => {
      flushSync(() => setShown(location))
    })

    void transition.finished
      .catch(() => {})
      .finally(() => {
        delete document.documentElement.dataset.nav
      })
  }, [location, shown])

  return shown
}
