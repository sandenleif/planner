//! Native Hülle der App.
//!
//! Die eigentliche Anwendung ist die Web-Oberfläche in `src/`. Hier steht nur,
//! was ein Browser nicht kann:
//!
//!   * ein Panel in der Menüleiste (macOS) bzw. im Infobereich (Windows),
//!     das aus dem Tray-Symbol aufklappt,
//!   * Schließen versteckt das Hauptfenster, statt die App zu beenden,
//!   * ein globales Tastenkürzel,
//!   * der Rückweg aus der Google-Anmeldung über `planner://`,
//!   * automatische Aktualisierungen.
//!
//! Auf Android fällt all das weg — dort ist die App eine normale Activity,
//! und Aktualisierungen laufen über den Store.

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{AppHandle, Emitter, Manager};

/// Ereignis, mit dem die Rust-Seite eine OAuth-Rückkehr ans Frontend meldet.
/// Muss zu `OAUTH_CALLBACK_EVENT` in src/auth/oauth.ts passen.
const OAUTH_EVENT: &str = "oauth://callback";

const MAIN: &str = "main";
const PANEL: &str = "panel";

// ------------------------------------------------------------------ Fenster

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn hide_panel_window(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.hide();
    }
}

/// Klappt das Menüleisten-Panel auf oder zu.
///
/// Positioniert wird über tauri-plugin-positioner, das sich die Koordinaten
/// des Tray-Symbols aus dem Klick-Ereignis merkt. Selbst rechnen wäre je
/// Plattform anders — und auf macOS mit mehreren Bildschirmen schnell falsch.
#[cfg(desktop)]
fn toggle_panel(app: &AppHandle) {
    use tauri_plugin_positioner::{Position, WindowExt};

    let Some(panel) = app.get_webview_window(PANEL) else {
        return;
    };

    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }

    // Unter dem Symbol auf Windows, darunter hängend auf macOS - beides
    // deckt TrayBottomCenter ab.
    let _ = panel.move_window(Position::TrayBottomCenter);
    let _ = panel.show();
    let _ = panel.set_focus();
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
    let open = MenuItem::with_id(app, "open", "Hauptfenster öffnen", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("main-tray")
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

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_main_window, hide_panel])
        .setup(|app| {
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
                tauri::WindowEvent::Focused(false) if window.label() == PANEL => {
                    let _ = window.hide();
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
