//! Bruecke zwischen der WebView und dem Homescreen-Widget.
//!
//! Warum es dieses Plugin ueberhaupt gibt: Ein App-Widget laeuft in einem
//! eigenen Prozess (dem Launcher) und kann die Daten der App nicht lesen. Die
//! IndexedDB der WebView schon gar nicht. Es braucht also einen Ort, an den die
//! App schreibt und von dem der Widget-Prozess liest - auf Android sind das
//! SharedPreferences - und ein Signal, dass sich dort etwas getan hat.
//!
//! Der zweite Teil ist der Grund gegen die einfachere Loesung, beide Seiten
//! einfach dieselbe Datei lesen zu lassen: ohne einen Anstoss ueber den
//! AppWidgetManager zeigt das Widget den geaenderten Stand erst beim naechsten
//! Aktualisierungslauf des Systems. Das kann eine halbe Stunde dauern.
//!
//! Die Rust-Seite ist bewusst duenn. Sie nimmt einen Schnappschuss entgegen und
//! reicht ihn nach Kotlin durch; gerechnet und formatiert wird im Frontend
//! (src/lib/widget.ts). Alles andere hiesse, die Regel "was ist heute faellig"
//! ein zweites Mal zu schreiben.
//!
//! Nur fuer Android uebersetzt: die Abhaengigkeit steht in
//! `src-tauri/Cargo.toml` unter `target.'cfg(target_os = "android")'`.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Muss zum Paketnamen des Kotlin-Teils passen (android/build.gradle.kts,
/// `namespace`) - danach sucht Tauri die Klasse zur Laufzeit.
const PLUGIN_IDENTIFIER: &str = "de.leifsanden.planner.widget";

// ------------------------------------------------------------------- Daten

/// Was das Widget anzeigt. Gegenstueck zu `WidgetSnapshot` in
/// src/lib/widget.ts und zu `SnapshotArgs` im Kotlin-Teil.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Millisekunden seit 1970. Das Widget zeigt einen Hinweis, wenn der Stand
    /// alt ist - ohne diese Zahl saehe es aus, als waere er von eben.
    pub generated_at_ms: i64,
    /// Offene Aufgaben, faellig bis einschliesslich heute.
    pub due_today: u32,
    /// Davon bereits ueberfaellig.
    pub overdue: u32,
    pub tasks: Vec<TaskLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLine {
    pub id: String,
    pub title: String,
    pub list_name: String,
    /// '#RRGGBB'.
    pub color: String,
    /// Fertig formatiert, z. B. "Heute 14:30".
    pub due: String,
    pub overdue: bool,
}

/// Antwort des Kotlin-Teils. `invoke.resolve()` schickt ein leeres Objekt;
/// nach `()` liesse sich das nicht deserialisieren.
#[derive(Debug, Deserialize)]
struct Empty {}

// ------------------------------------------------------------------ Fehler

#[derive(Debug)]
pub enum Error {
    /// Der Aufruf hat den Kotlin-Teil nicht erreicht oder ist dort gescheitert.
    Bridge(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Bridge(message) => write!(f, "Widget-Bruecke: {message}"),
        }
    }
}

impl std::error::Error for Error {}

/// Ohne Serialize kaeme der Fehler nicht durch die IPC-Grenze zurueck ins
/// Frontend - Tauri verlangt das von jedem Fehlertyp eines Befehls.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

// ----------------------------------------------------------------- Zugriff

pub struct PlannerWidget<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> PlannerWidget<R> {
    pub fn update_snapshot(&self, snapshot: Snapshot) -> Result<()> {
        self.0
            .run_mobile_plugin::<Empty>("updateSnapshot", snapshot)
            .map(|_| ())
            .map_err(|error| Error::Bridge(error.to_string()))
    }
}

pub trait PlannerWidgetExt<R: Runtime> {
    fn planner_widget(&self) -> &PlannerWidget<R>;
}

impl<R: Runtime, T: Manager<R>> PlannerWidgetExt<R> for T {
    fn planner_widget(&self) -> &PlannerWidget<R> {
        self.state::<PlannerWidget<R>>().inner()
    }
}

// ----------------------------------------------------------------- Befehle

#[tauri::command]
fn update_snapshot<R: Runtime>(app: AppHandle<R>, payload: Snapshot) -> Result<()> {
    app.planner_widget().update_snapshot(payload)
}

// ------------------------------------------------------------------ Aufbau

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("planner-widget")
        .invoke_handler(tauri::generate_handler![update_snapshot])
        .setup(|app, api| {
            app.manage(register(api)?);
            Ok(())
        })
        .build()
}

fn register<R: Runtime, C: serde::de::DeserializeOwned>(
    api: PluginApi<R, C>,
) -> std::result::Result<PlannerWidget<R>, Box<dyn std::error::Error>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "PlannerWidgetPlugin")?;
    Ok(PlannerWidget(handle))
}
