import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { CheckCircle2, Search, Settings, WifiOff, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthProvider'
import { SignInScreen } from '@/auth/SignInScreen'
import { useGlobalRealtime } from '@/data/hooks'
import { useRepository } from '@/data/RepositoryProvider'
import { Sidebar } from '@/features/lists/Sidebar'
import { BottomNav } from '@/features/nav/BottomNav'
import { CommandPalette } from '@/features/search/CommandPalette'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { AgendaPage } from '@/pages/AgendaPage'
import { HomePage } from '@/pages/HomePage'
import { InvitePage } from '@/pages/InvitePage'
import { ListPage } from '@/pages/ListPage'
import { PanelPage } from '@/pages/PanelPage'
import { useTheme } from '@/app/theme'
import { useWidgetSync } from '@/app/widgetSync'
import { hasModKey, isAndroid, modKeyLabel } from '@/lib/platform'
import { startUpdateChecks } from '@/lib/updater'
import { Toaster } from '@/ui/Toaster'

export function App() {
  // Der Aufruf setzt die Theme-Klasse auf <html> - der Rueckgabewert wird
  // erst im Einstellungsdialog gebraucht.
  useTheme()

  const auth = useAuth()
  const location = useLocation()

  if (auth.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <CheckCircle2 size={28} className="animate-pulse text-accent-600" />
      </div>
    )
  }

  // Das Menueleisten-Panel laeuft in einem eigenen Fenster und bekommt
  // bewusst NICHT die Shell: keine Seitenleiste, kein Kopfbalken, keine
  // Navigation. Ein Panel, aus dem man herausnavigiert, ist ein Fenster
  // mit falschem Rahmen.
  //
  // Die Pruefung steht VOR dem Anmelde-Gate: sonst landete das vollstaendige
  // Anmeldeformular in einem 380 Pixel breiten Popover ohne Schliessknopf.
  // Das Panel zeigt stattdessen einen kurzen Hinweis und fuehrt ins
  // Hauptfenster.
  //
  // Die Abfrage auf Android ist ein Sicherheitsnetz: Dort gibt es nur eine
  // WebView, und wenn dort je wieder #/panel landet, gehoert die App-Ansicht
  // hin und nicht ein Panel mit einem Knopf ins Hauptfenster, das es auf
  // Android gar nicht gibt.
  if (location.pathname === '/panel' && !isAndroid) {
    return <PanelPage />
  }

  // Einladungslinks brauchen ihre eigene Seite, auch ohne Anmeldung -
  // sie erklaert dort, dass man sich erst anmelden muss.
  const isInvite = location.pathname.startsWith('/invite/')

  if (auth.mode === 'supabase' && !auth.userId && !isInvite) {
    return <SignInScreen />
  }

  return <Shell />
}

function Shell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const repo = useRepository()
  const { pathname } = useLocation()

  /*
   * Das Menü schließt bei jedem Ansichtswechsel.
   *
   * Nicht nur beim Antippen eines Eintrags — dafür sorgt schon onNavigate.
   * Der Fall, um den es hier geht, ist die Zurück-Geste: Sie führt die
   * WebView eine Seite zurück (siehe unten), und ohne diese Zeile bliebe das
   * ganzflächige Menü über einer Ansicht stehen, die man gar nicht mehr
   * ausgewählt hat.
   *
   * Zur Zurück-Geste selbst: Sie funktioniert bereits. Tauri registriert auf
   * Android einen Rückruf, der `webView.goBack()` aufruft, solange es einen
   * Verlauf gibt, und die App sonst in den Hintergrund schickt. Weil die App
   * HashRouter benutzt, legt jede Navigation einen Verlaufseintrag an — die
   * Geste führt also dorthin zurück, wo man herkam.
   */
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  // Strg/Cmd+K global. Auf window statt auf einem Container, damit das
  // Kuerzel auch greift, wenn der Fokus in einem Eingabefeld steht.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && hasModKey(event)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Bewusst hier und nicht im Panel: sonst pruefen zwei Fenster parallel und
  // der Nutzer bekommt dieselbe Meldung doppelt.
  useEffect(() => startUpdateChecks(), [])

  // Aus demselben Grund hier: Tray-Symbol und Homescreen-Widget haben genau
  // einen Absender.
  useWidgetSync()

  // Fremdaenderungen live nachziehen - fuer alle Listen, nicht nur die
  // geoeffnete. Startseite und Agenda zeigen listenuebergreifend.
  useGlobalRealtime()

  return (
    <div className="flex h-full">
      {/* Ab md dauerhaft sichtbar, darunter ein Overlay-Panel. */}
      {/*
        Ab md eine dauerhafte Seitenleiste, darunter eine GANZE Seite.

        Vorher fuhr auf dem Telefon eine 240 Pixel breite Leiste von links
        herein — ein Schreibtisch-Muster in klein. Auf einem 390 Pixel breiten
        Schirm ist das kein Menue, sondern ein gequetschtes Fenster: Die
        Listennamen brechen um, der Rest der App schimmert daneben durch, und
        es ist nicht klar, ob man noch in der Liste ist oder schon woanders.

        Ganzflaechig gibt es diese Frage nicht. Sie steigt von unten auf, wie
        jede andere Ansicht auf einem Telefon auch, und geht ueber das X wieder
        weg.
      */}
      <aside
        className={clsx(
          'z-30 flex shrink-0 flex-col bg-panel md:w-60 md:border-r md:border-subtle',
          'max-md:fixed max-md:inset-0 max-md:w-full',
          'max-md:transition-[opacity,transform] max-md:duration-200 max-md:ease-out',
          // Fixed misst sich am Sichtfenster, nicht am <body> - dessen
          // safe-area-Polster gilt hier also nicht.
          'max-md:pt-[env(safe-area-inset-top,0px)]',
          menuOpen
            ? 'max-md:translate-y-0 max-md:opacity-100'
            : 'max-md:pointer-events-none max-md:translate-y-3 max-md:opacity-0',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-4" data-tauri-drag-region>
          <CheckCircle2 size={18} className="text-accent-600" />
          <span className="text-[0.9375rem] font-semibold">Planner</span>
          {repo.kind === 'local' && (
            <span
              className="ml-auto flex items-center gap-1 rounded-md bg-sunken px-1.5 py-0.5 text-[10px] text-muted"
              title="Lokaler Modus — Daten liegen nur auf diesem Gerät"
            >
              <WifiOff size={10} />
              lokal
            </span>
          )}

          {/* Ohne Hintergrund zum Danebentippen braucht es einen sichtbaren
              Ausgang. Auf dem Desktop gibt es nichts zu schliessen. */}
          <button
            onClick={() => setMenuOpen(false)}
            className="btn-ghost -mr-2 ml-auto px-2 md:hidden"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-3 pb-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg border border-subtle bg-sunken px-3 py-2 text-sm text-muted transition-colors hover:border-accent-500 hover:text-ink"
          >
            <Search size={15} className="shrink-0" />
            <span className="flex-1 text-left">Suchen …</span>
            {/* Ein Tastenkürzel auf einem Telefon anzuzeigen, ist bestenfalls
                Zierde und schlimmstenfalls ein Versprechen, das das Gerät
                nicht halten kann. */}
            <kbd className="shrink-0 rounded border border-subtle px-1 py-0.5 text-[10px] max-md:hidden">
              {modKeyLabel}+K
            </kbd>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Sidebar onNavigate={() => setMenuOpen(false)} />
        </div>

        <div className="shrink-0 border-t border-subtle p-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn-ghost w-full justify-start max-md:py-3"
          >
            <Settings size={16} />
            Einstellungen
          </button>
        </div>
      </aside>

      {/* Der abdunkelnde Hintergrund entfaellt: Es gibt nichts mehr, was
          dahinter durchschiene. */}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Auf dem Desktop die Ziehflaeche fuer das Fenster, auf dem Telefon
            nur noch die Suche. Der Menue-Knopf sass hier, solange das
            Hamburger-Menue der einzige Weg zu den anderen Ansichten war -
            jetzt steht die Navigation unten, in Daumenreichweite. */}
        <header
          className="flex h-11 shrink-0 items-center gap-2 px-3 md:h-8"
          data-tauri-drag-region
        >
          <span className="flex-1" />

          <button
            onClick={() => setSearchOpen(true)}
            className="btn-ghost px-2 md:hidden"
            aria-label="Suchen"
          >
            <Search size={18} />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/heute" element={<AgendaPage mode="today" />} />
            <Route path="/demnaechst" element={<AgendaPage mode="upcoming" />} />
            <Route path="/list/:listId" element={<ListPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </main>

        <BottomNav onOpenLists={() => setMenuOpen(true)} listsOpen={menuOpen} />
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster />
    </div>
  )
}
