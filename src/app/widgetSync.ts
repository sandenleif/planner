import { useEffect } from 'react'
import { useAllTasks, useLists } from '@/data/hooks'
import {
  buildWidgetSnapshot,
  clearWidgetSnapshot,
  publishWidgetSnapshot,
} from '@/lib/widget'

/**
 * Hält Tray-Symbol und Homescreen-Widget auf dem Stand der App.
 *
 * Gehört genau einmal in den Baum, und zwar in die Shell des Hauptfensters:
 * Das Menüleisten-Panel läuft in einem eigenen Fenster mit eigener WebView und
 * denselben Daten. Riefe es diesen Hook ebenfalls auf, schrieben zwei Fenster
 * abwechselnd dieselbe Zahl ans selbe Symbol — meistens unauffällig, bis eines
 * von beiden gerade einen älteren Stand im Cache hat.
 */

/**
 * Auch ohne neue Daten wandert die Anzeige weiter: um Mitternacht wechselt der
 * Tag, und eine Aufgabe um 14:30 wird um 14:31 überfällig. Fünf Minuten sind
 * fein genug, dass niemand es bemerkt, und grob genug, dass es nichts kostet —
 * gerechnet wird ohnehin nur auf dem Query-Cache, gesendet nur bei Änderung.
 */
const RECOMPUTE_INTERVAL_MS = 1000 * 60 * 5

export function useWidgetSync(): void {
  const { data: lists = [] } = useLists()
  const { data: tasks = [] } = useAllTasks()

  useEffect(() => {
    const publish = () => void publishWidgetSnapshot(buildWidgetSnapshot(tasks, lists))

    publish()
    const timer = setInterval(publish, RECOMPUTE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [tasks, lists])

  // Verschwindet die Shell, ist der Nutzer abgemeldet oder die App wechselt in
  // den Anmeldebildschirm. Fremde Aufgabentitel dürfen dann nicht auf dem
  // Homescreen stehen bleiben.
  useEffect(() => () => void clearWidgetSnapshot(), [])
}
