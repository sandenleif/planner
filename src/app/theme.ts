import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'planner:theme'

/**
 * Theme-Umschaltung.
 *
 * 'system' ist die Vorgabe und bleibt es auch: es wird kein Wert eingefroren,
 * sondern dem Betriebssystem gefolgt. Wechselt macOS abends auf Dunkel, zieht
 * die App mit - deshalb der Listener auf die MediaQuery statt einer einmaligen
 * Abfrage beim Start.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme | null) ?? 'system',
  )

  useEffect(() => {
    localStorage.setItem(KEY, theme)

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      // Faerbt Scrollbalken und native Formularelemente passend ein.
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }

    apply()
    if (theme !== 'system') return

    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  return { theme, setTheme }
}
