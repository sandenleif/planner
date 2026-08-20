//! Native Hülle der App.
//!
//! Die eigentliche Anwendung ist die Web-Oberfläche in `src/`. Hier steht nur,
//! was ein Browser nicht kann:
//!
//!   * ein Panel in der Menüleiste (macOS) bzw. im Infobereich (Windows),
//!     das aus dem Tray-Symbol aufklappt,
//!   * eine Anzahl am Tray-Symbol, die zeigt, was heute ansteht,
//!   * ein angehefteter Panel-Modus: das Panel bleibt als Widget stehen,
//!     statt beim Klick daneben zu verschwinden,
//!   * Schließen versteckt das Hauptfenster, statt die App zu beenden,
//!   * ein globales Tastenkürzel,
//!   * der Rückweg aus der Google-Anmeldung über `planner://`,
//!   * automatische Aktualisierungen.
//!
//! Auf Android fällt all das weg — dort ist die App eine normale Activity,
//! Aktualisierungen laufen über den Store, und die glanceable Ansicht ist
//! das Homescreen-Widget (siehe `plugins/planner-widget`).

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{AppHandle, Emitter, Manager};

/// Ereignis, mit dem die Rust-Seite eine OAuth-Rückkehr ans Frontend meldet.
/// Muss zu `OAUTH_CALLBACK_EVENT` in src/auth/oauth.ts passen.
const OAUTH_EVENT: &str = "oauth://callback";

/// Meldet dem Panel, dass es gerade sichtbar geworden ist. Das Fenster lebt
/// dauerhaft im Hintergrund weiter — ohne dieses Signal zeigte es beim
/// Aufklappen den Stand von vorhin.
/// Muss zu `PANEL_SHOWN_EVENT` in src/lib/desktop.ts passen.
#[cfg(desktop)]
const PANEL_SHOWN: &str = "panel://shown";

/// Kuendigt dem Panel an, dass es gleich verschwindet — damit es sich
/// ausblenden kann, statt schlagartig weg zu sein.
/// Muss zu `PANEL_HIDING_EVENT` in src/lib/desktop.ts passen.
#[cfg(desktop)]
const PANEL_HIDING: &str = "panel://hiding";

/// Wie lange zwischen Ankuendigung und tatsaechlichem Verstecken liegt.
///
/// Muss etwas ueber der Dauer der Ausblend-Animation im Frontend liegen (dort
/// 120 ms). Zu kurz, und das Fenster ist weg, bevor die Bewegung sichtbar war;
/// zu lang, und ein Klick daneben fuehlt sich zaeh an — bei einem Popover, das
/// man dutzendfach am Tag auf- und zuklappt, faellt das sofort auf.
#[cfg(desktop)]
const HIDE_DELAY: std::time::Duration = std::time::Duration::from_millis(135);

/// ID des Tray-Symbols. Wird gebraucht, um es später wiederzufinden und die
/// Anzahl daran zu schreiben.
#[cfg(desktop)]
const TRAY: &str = "main-tray";

const MAIN: &str = "main";
const PANEL: &str = "panel";

/// Ob das Panel angeheftet ist.
///
/// Der Zustand gehört nach Rust, nicht ins Frontend: Über das Verstecken bei
/// Fokusverlust entscheidet `on_window_event`, und das läuft, noch bevor eine
/// WebView gefragt werden könnte. Ein Umweg über das Frontend wäre ein
/// Wettlauf — das Panel wäre weg, bevor die Antwort da ist.
///
/// Was der Nutzer eingestellt hat, merkt sich das Frontend (localStorage) und
/// meldet es beim Start hierher zurück. Rust hält nur den laufenden Zustand.
#[cfg(desktop)]
#[derive(Default)]
struct PanelState {
    pinned: AtomicBool,
    /// Zaehlt jedes Zeigen und Verstecken mit.
    ///
    /// Das verzoegerte Verstecken merkt sich den Stand beim Start und prueft
    /// ihn beim Aufwachen erneut. Klappt jemand das Panel innerhalb der 135 ms
    /// wieder auf, ist die Zahl weitergelaufen — und das wartende Verstecken
    /// gehoert zu einer Vorgeschichte und laesst das Fenster in Ruhe. Ohne
    /// diesen Zaehler wuerde ein schneller Doppelklick aufs Tray-Symbol das
    /// gerade geoeffnete Panel sofort wieder zuklappen.
    generation: AtomicU64,
}

#[cfg(desktop)]
fn panel_is_pinned(app: &AppHandle) -> bool {
    // try_state statt state: Fensterereignisse können auftreten, bevor setup()
    // den Zustand registriert hat. Ein Panik-Abbruch beim Programmstart wäre
    // ein hoher Preis für eine Frage, die sich mit "nein" beantworten lässt.
    app.try_state::<PanelState>()
        .is_some_and(|state| state.pinned.load(Ordering::Relaxed))
}

// ------------------------------------------------------------------ Fenster

/// Legt das Menueleisten-Panel an.
///
/// Bewusst hier und nicht in tauri.conf.json: Auf Android gibt es genau eine
/// WebView, und Tauri baut sie aus der Fensterliste der Konfiguration. Stand
/// das Panel dort mit, startete die Android-App in der Panel-Ansicht - mit dem
/// Hinweis "im Hauptfenster anmelden" und einem Knopf, der auf Android nichts
/// tut, weil der zugehoerige Befehl #[cfg(desktop)] ist. Genau so ist es
/// passiert.
///
/// Zur Laufzeit erzeugt ist das Fenster damit an dieselbe Bedingung gebunden
/// wie alles andere, was es braucht: cfg(desktop).
#[cfg(desktop)]
fn create_panel_window(app: &AppHandle) -> tauri::Result<()> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let builder = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("index.html#/panel".into()))
        .title("Planner")
        .inner_size(380.0, 520.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // Randlos allein genuegt nicht fuer runde Ecken - dafuer muss der Rest
        // wirklich durchsichtig sein. Die sichtbare Flaeche malt das Frontend.
        .transparent(true);

    // Das Popover-Material gibt es nur auf macOS. Auf den anderen Plattformen
    // traegt die knapp deckende Flaeche aus index.css den Panel allein.
    #[cfg(target_os = "macos")]
    let builder = {
        use tauri::utils::config::{WindowEffect, WindowEffectState, WindowEffectsConfig};
        builder.effects(WindowEffectsConfig {
            effects: vec![WindowEffect::Popover],
            state: Some(WindowEffectState::Active),
            radius: Some(14.0),
            color: None,
        })
    };

    builder.build()?;
    Ok(())
}

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Blendet das Panel aus: erst ankuendigen, dann kurz warten, dann verstecken.
///
/// Der Umweg ist noetig, weil das Verstecken eines Fensters nichts ist, was
/// sich animieren liesse — es ist sofort weg. Also laeuft die Bewegung im
/// Frontend, und Rust wartet sie ab.
#[cfg(desktop)]
fn hide_panel_window(app: &AppHandle) {
    let Some(panel) = app.get_webview_window(PANEL) else {
        return;
    };

    // Ist es ohnehin unsichtbar, gibt es nichts auszublenden - und vor allem
    // keinen Grund, den Zaehler weiterzudrehen.
    if !panel.is_visible().unwrap_or(false) {
        return;
    }

    let Some(state) = app.try_state::<PanelState>() else {
        // Ohne Zustand kein Zaehler und damit kein sicheres Verzoegern.
        let _ = panel.hide();
        return;
    };

    let generation = state.generation.fetch_add(1, Ordering::Relaxed) + 1;
    let _ = app.emit_to(PANEL, PANEL_HIDING, ());

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(HIDE_DELAY);

        let still_current = handle
            .try_state::<PanelState>()
            .is_some_and(|state| state.generation.load(Ordering::Relaxed) == generation);

        if !still_current {
            return;
        }

        if let Some(panel) = handle.get_webview_window(PANEL) {
            let _ = panel.hide();
        }
    });
}

/// Zeigt das Panel und meldet ihm, dass es sichtbar geworden ist.
///
/// `move_to_tray` steuert die Positionierung: beim Aufklappen aus dem
/// Tray-Symbol gehört das Panel unter das Symbol, im angehefteten Modus
/// dorthin, wo der Nutzer es hingeschoben hat.
#[cfg(desktop)]
fn show_panel_window(app: &AppHandle, move_to_tray: bool) {
    use tauri_plugin_positioner::{Position, WindowExt};

    let Some(panel) = app.get_webview_window(PANEL) else {
        return;
    };

    if move_to_tray {
        // Unter dem Symbol auf Windows, darunter hängend auf macOS - beides
        // deckt TrayBottomCenter ab.
        let _ = panel.move_window(Position::TrayBottomCenter);
    }

    // Vor dem Zeigen: ein wartendes Verstecken aus der letzten Sekunde darf
    // das Fenster nicht gleich wieder zuklappen.
    if let Some(state) = app.try_state::<PanelState>() {
        state.generation.fetch_add(1, Ordering::Relaxed);
    }

    let _ = panel.show();
    let _ = panel.set_focus();
    let _ = app.emit_to(PANEL, PANEL_SHOWN, ());
}

/// Klappt das Menüleisten-Panel auf oder zu.
///
/// Positioniert wird über tauri-plugin-positioner, das sich die Koordinaten
/// des Tray-Symbols aus dem Klick-Ereignis merkt. Selbst rechnen wäre je
/// Plattform anders — und auf macOS mit mehreren Bildschirmen schnell falsch.
///
/// Ausgenommen ist das angeheftete Panel: wer es einmal an eine Bildschirmecke
/// geschoben hat, erwartet es dort wieder und nicht am Tray-Symbol.
#[cfg(desktop)]
fn toggle_panel(app: &AppHandle) {
    let Some(panel) = app.get_webview_window(PANEL) else {
        return;
    };

    if panel.is_visible().unwrap_or(false) {
        // Ueber hide_panel_window: der Klick aufs Tray-Symbol ist der
        // haeufigste Weg, das Panel zu schliessen - gerade dort soll es sich
        // ausblenden statt zu verschwinden.
        hide_panel_window(app);
        return;
    }

    show_panel_window(app, !panel_is_pinned(app));
}

// ------------------------------------------------------------------ Befehle

/// Holt das Hauptfenster nach vorn und springt optional zu einer Route.
///
/// `route` kommt aus dem Frontend, landet also in einer eval()-Zeichenkette.
/// Deshalb wird sie geprüft, bevor sie dort hineingerät: nur Zeichen, die in
/// einer Hash-Route vorkommen können. Alles andere wird verworfen statt
/// escaped — bei einer Route gibt es keinen legitimen Grund für ein
/// Anführungszeichen.
#[tauri::command]
fn open_main_window(app: AppHandle, route: Option<String>) {
    #[cfg(desktop)]
    {
        hide_panel_window(&app);
        show_main_window(&app);

        if let Some(route) = route {
            let safe = route
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "/-_".contains(c));

            if safe && route.starts_with('/') {
                if let Some(window) = app.get_webview_window(MAIN) {
                    // to_string() auf einen serde_json::Value liefert ein
                    // korrekt gequotetes JS-Literal.
                    let literal = serde_json::Value::String(format!("#{route}")).to_string();
                    let _ = window.eval(&format!("window.location.hash = {literal};"));
                }
            } else {
                log::warn!("Route abgelehnt: {route}");
            }
        }
    }

    #[cfg(not(desktop))]
    let _ = (app, route);
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    #[cfg(desktop)]
    hide_panel_window(&app);

    #[cfg(not(desktop))]
    let _ = app;
}

/// Heftet das Panel an oder löst es wieder.
///
/// Angeheftet bleibt es beim Klick daneben stehen — aus dem Popover wird ein
/// Widget, das dauerhaft auf dem Schreibtisch liegt. Deshalb wird es beim
/// Anheften auch gleich gezeigt: Anheften ist eine Bitte, es zu sehen.
#[tauri::command]
fn set_panel_pinned(app: AppHandle, pinned: bool) {
    #[cfg(desktop)]
    {
        if let Some(state) = app.try_state::<PanelState>() {
            state.pinned.store(pinned, Ordering::Relaxed);
        }

        if pinned {
            // Nicht ans Tray-Symbol rücken: die Position hat das Frontend
            // gerade wiederhergestellt, bevor es hier hereinkam.
            show_panel_window(&app, false);
        }
    }

    #[cfg(not(desktop))]
    let _ = (app, pinned);
}

/// Schreibt die Anzahl der heute offenen Aufgaben ans Tray-Symbol.
///
/// Der Sinn des ganzen Panels ist, kurz nachzusehen, was ansteht. Wenn schon
/// das Symbol die Antwort trägt, entfällt auch dieser Schritt — auf macOS als
/// Zahl neben dem Symbol, überall als Kurzinfo beim Darüberfahren.
///
/// Kein `Result`: dass eine Zahl am Symbol nicht ankommt, ist kein Grund, im
/// Frontend einen Fehler zu behandeln. Es steht im Log und gut.
#[tauri::command]
fn set_tray_badge(app: AppHandle, count: u32) {
    #[cfg(desktop)]
    {
        let Some(tray) = app.tray_by_id(TRAY) else {
            log::warn!("Tray-Symbol nicht gefunden - Anzahl nicht gesetzt");
            return;
        };

        // Linux kennt beides nicht (der Infobereich ist dort kein einheitliches
        // Konzept), Windows kennt keinen Titel. Beide Aufrufe scheitern dann
        // still - das ist in Ordnung, das Panel selbst zeigt die Zahl ohnehin.
        #[cfg(target_os = "macos")]
        {
            let title = if count == 0 {
                None
            } else {
                Some(count.to_string())
            };
            if let Err(error) = tray.set_title(title) {
                log::warn!("Anzahl am Tray-Symbol nicht gesetzt: {error}");
            }
        }

        let tooltip = match count {
            0 => "Planner — nichts fällig".to_string(),
            1 => "Planner — 1 Aufgabe heute".to_string(),
            n => format!("Planner — {n} Aufgaben heute"),
        };
        if let Err(error) = tray.set_tooltip(Some(tooltip)) {
            log::warn!("Kurzinfo am Tray-Symbol nicht gesetzt: {error}");
        }
    }

    #[cfg(not(desktop))]
    let _ = (app, count);
}

// ------------------------------------------------------------------ Deep-Link

/// Reicht eine `planner://`-URL ans Frontend weiter und holt das Fenster nach
/// vorn — nach der Anmeldung im Browser soll die App sichtbar werden.
fn forward_deep_link(app: &AppHandle, url: &str) {
    if !url.starts_with("planner://") {
        return;
    }

    log::info!("Deep-Link empfangen");

    // emit_to statt emit: Haupt- und Panel-Fenster laden dieselbe App und
    // wuerden beide auf den Rueckweg horchen. Ein PKCE-Code laesst sich aber
    // nur EINMAL einloesen - das zweite Fenster bekaeme zwangslaeufig einen
    // Fehler, und der landet vor den Augen des Nutzers.
    let _ = app.emit_to(MAIN, OAUTH_EVENT, url.to_string());

    #[cfg(desktop)]
    show_main_window(app);
}

// --------------------------------------------------------------------- Tray

#[cfg(desktop)]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    // Auf Linux gibt es kein verlässliches Linksklick-Ereignis für Tray-Symbole:
    // je nach Desktop-Umgebung klappt dort direkt das Menü auf. Ohne einen
    // Eintrag fürs Panel wäre es auf diesen Systemen gar nicht erreichbar.
    let panel = MenuItem::with_id(app, "panel", "Panel anzeigen", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Hauptfenster öffnen", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&panel, &open, &separator, &quit])?;

    TrayIconBuilder::with_id(TRAY)
        .icon(
            app.default_window_icon()
                .expect("Bundle ohne Fenstersymbol")
                .clone(),
        )
        .tooltip("Planner")
        // Linksklick klappt das Panel auf. Das Menü bleibt auf der rechten
        // Maustaste - so ist der häufige Weg der kurze.
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "panel" => show_panel_window(app, !panel_is_pinned(app)),
            "open" => {
                hide_panel_window(app);
                show_main_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Muss zuerst laufen: der Positioner merkt sich hier, wo das
            // Symbol sitzt. Ohne diesen Aufruf landet das Panel in der Ecke.
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_panel(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Strg+Umschalt+Leertaste klappt das Panel von überall auf.
#[cfg(desktop)]
fn setup_global_shortcut(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

    let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, pressed, event| {
                if pressed == &hotkey && event.state() == ShortcutState::Pressed {
                    toggle_panel(app);
                }
            })
            .build(),
    )?;

    if let Err(error) = app.global_shortcut().register(hotkey) {
        log::warn!("Globales Tastenkürzel nicht verfügbar: {error}");
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // single-instance MUSS vor deep-link stehen: unter Windows und Linux
    // startet ein Deep-Link einen neuen Prozess mit der URL in argv.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        show_main_window(app);
        if let Some(url) = argv.iter().find(|arg| arg.starts_with("planner://")) {
            forward_deep_link(app, url);
        }
    }));

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Nur Android: die Bruecke zum Homescreen-Widget. Bewusst ein eigenes
    // Plugin und keine Datei, die beide Seiten lesen - der Kotlin-Teil muss
    // nach dem Schreiben den AppWidgetManager anstossen, sonst zeigt das
    // Widget bis zum naechsten Aktualisierungsintervall den alten Stand.
    //
    // Die Abhaengigkeit steht in Cargo.toml unter target.'cfg(target_os =
    // "android")'. Damit kann ein Fehler im Widget-Plugin den Desktop-Build
    // nicht anfassen - und der liefert die Releases aus.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_planner_widget::init());

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_main_window,
            hide_panel,
            set_panel_pinned,
            set_tray_badge
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.manage(PanelState::default());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Im Entwicklungsmodus gibt es keinen Installer, der planner://
            // ins System eintraegt - ohne das laeuft der OAuth-Rueckweg ins
            // Leere, und zwar ohne Fehlermeldung.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register_all() {
                    log::warn!("Schema planner:// nicht registrierbar: {error}");
                }
            }

            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        forward_deep_link(&handle, url.as_str());
                    }
                });
            }

            #[cfg(desktop)]
            {
                create_panel_window(app.handle())?;
                setup_tray(app.handle())?;
                setup_global_shortcut(app.handle())?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            match event {
                // Ein Menueleisten-Panel schliesst sich, sobald man woanders
                // hinklickt. Ohne das bliebe es ueber allen Fenstern stehen.
                //
                // Genau das ist aber der angeheftete Modus: dort ist das
                // Stehenbleiben der Zweck, und das Verstecken waere der Fehler.
                tauri::WindowEvent::Focused(false)
                    if window.label() == PANEL && !panel_is_pinned(window.app_handle()) =>
                {
                    // Ueber hide_panel_window statt window.hide(): so laeuft
                    // auch beim Klick daneben die Ausblend-Animation.
                    hide_panel_window(window.app_handle());
                }
                // Das Hauptfenster zu schliessen beendet die App nicht - sie
                // lebt in der Menueleiste weiter. Beendet wird ueber das
                // Tray-Menue.
                tauri::WindowEvent::CloseRequested { api, .. } if window.label() == MAIN => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                _ => {}
            }

            #[cfg(not(desktop))]
            {
                let _ = (window, event);
            }
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Tauri-Anwendung");
}
