//! Native Hülle der App.
//!
//! Die eigentliche Anwendung ist die Web-Oberfläche in `src/`. Hier steht nur,
//! was ein Browser nicht kann und was den Unterschied zwischen "Webseite im
//! Fenster" und "Programm" ausmacht:
//!
//!   * ein Symbol im Infobereich (Windows) bzw. in der Menüleiste (macOS),
//!   * Schließen versteckt das Fenster, statt die App zu beenden,
//!   * ein globales Tastenkürzel, das das Fenster von überall hervorholt.
//!
//! Auf Android fällt all das weg — dort ist die App eine normale Activity,
//! und das Pendant zum Tray ist das Home-Screen-Widget (siehe README).

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{AppHandle, Manager};

/// Holt das Hauptfenster nach vorn — auch wenn es versteckt oder minimiert ist.
#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Sichtbar -> verstecken, versteckt -> zeigen. Für das globale Tastenkürzel
/// und den Klick aufs Tray-Symbol.
#[cfg(desktop)]
fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

#[cfg(desktop)]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Planner öffnen", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(
            app.default_window_icon()
                .expect("Bundle ohne Fenstersymbol")
                .clone(),
        )
        .tooltip("Planner")
        .menu(&menu)
        // Linksklick soll das Fenster holen, nicht das Menü öffnen. Das Menü
        // hängt weiterhin auf der rechten Maustaste.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Strg+Umschalt+Leertaste holt das Fenster von überall her.
///
/// Bewusst dieselbe Kombination auf allen Desktops: `Modifiers::SUPER` wäre
/// auf macOS die Cmd-Taste, aber ein einheitliches Kürzel ist leichter zu
/// merken als ein plattformabhängiges.
#[cfg(desktop)]
fn setup_global_shortcut(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

    let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, pressed, event| {
                if pressed == &hotkey && event.state() == ShortcutState::Pressed {
                    toggle_main_window(app);
                }
            })
            .build(),
    )?;

    // Schlägt fehl, wenn ein anderes Programm das Kürzel belegt. Das ist kein
    // Grund, den Start abzubrechen - die App funktioniert auch ohne.
    if let Err(error) = app.global_shortcut().register(hotkey) {
        log::warn!("Globales Tastenkürzel nicht verfügbar: {error}");
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Zweiter Start soll das vorhandene Fenster hervorholen, statt eine
    // zweite Instanz mit derselben lokalen Datenbank zu oeffnen.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main_window(app);
    }));

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(desktop)]
            {
                setup_tray(app.handle())?;
                setup_global_shortcut(app.handle())?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Fenster schliessen beendet die App nicht - sie lebt im Tray
            // weiter, damit der Fokus-Timer und spaeter Erinnerungen laufen.
            // Beendet wird ueber das Tray-Menue.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(desktop))]
            {
                let _ = (window, event);
            }
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Tauri-Anwendung");
}
