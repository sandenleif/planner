//! Aktualisierung der Android-App aus der App heraus.
//!
//! # Warum nicht tauri-plugin-updater
//!
//! Der Updater von Tauri tauscht Dateien auf der Platte aus und startet das
//! Programm neu. Auf Android gibt es beides nicht: Eine App ist ein vom System
//! verwaltetes Paket, ihr Verzeichnis ist fuer sie selbst nicht beschreibbar,
//! und ersetzen darf es nur der PackageInstaller. Deshalb ist der Updater in
//! src-tauri/Cargo.toml auf Desktop beschraenkt, und hier steht der andere Weg:
//! Manifest lesen, APK laden, dem System zum Einspielen geben.
//!
//! # Warum das Update trotzdem keine Neuinstallation ist
//!
//! Android ersetzt ein Paket, wenn Paketname UND Signatur zum installierten
//! passen. Dann bleibt /data/data/de.leifsanden.planner unangetastet - und
//! darin liegen localStorage und IndexedDB der WebView, also die
//! Supabase-Sitzung und der Zwischenspeicher. Der Nutzer bleibt angemeldet und
//! findet alles vor, wie er es verlassen hat.
//!
//! Passt die Signatur nicht, verweigert das System das Update
//! (INSTALL_FAILED_UPDATE_INCOMPATIBLE). Der einzige Ausweg waere
//! deinstallieren - und das loescht die Daten. Ein einmal verteiltes Debug-APK
//! ist deshalb eine Sackgasse: es traegt den Debug-Schluessel und laesst sich
//! von keiner Release-Fassung mehr ueberschreiben.
//!
//! # Warum hier keine Signaturpruefung wie auf dem Desktop stattfindet
//!
//! Auf dem Desktop prueft der Updater eine minisign-Signatur, bevor er ein
//! Paket einspielt - notwendigerweise, denn Windows und macOS haetten nichts
//! dagegen, ein fremdes Programm ueber das eigene zu schreiben.
//!
//! Auf Android macht genau diese Pruefung das System, und zwar schaerfer: Es
//! vergleicht das Signaturzertifikat des neuen APK mit dem des installierten
//! und lehnt jede Abweichung ab. Ein ausgetauschtes Paket - ob durch ein
//! uebernommenes GitHub-Konto oder einen manipulierten Download - kommt damit
//! nicht durch. Eine zweite Signatur obendrauf pruefte dieselbe Eigenschaft ein
//! zweites Mal; sie braeuchte einen eigenen Schluessel in der CI und koennte im
//! Fehlerfall nur dasselbe Nein aussprechen, das das System ohnehin sagt.
//!
//! Was bleibt, ist die Frage, WELCHES Paket ueberhaupt angeboten wird. Dagegen
//! steht die Pruefung in `start_update`: die Adresse muss unterhalb der
//! Releases dieses Repositorys liegen. Die Adresse des Manifests kennt nur der
//! Kotlin-Teil. Ein Fehler im Frontend kann darueber also nichts anderes
//! einspielen lassen.
//!
//! # Aufteilung
//!
//! Netz und Installation liegen im Kotlin-Teil, nicht hier. Das spart einen
//! HTTP-Client im Rust-Build fuer Android - und damit TLS-Bibliotheken, die
//! sich fuer diese Zielplattform erst uebersetzen lassen muessten. Es umgeht
//! ausserdem die Same-Origin-Regel: ein `fetch()` aus der WebView nach
//! github.com waere eine fremde Herkunft und braeuchte sowohl eine weitere
//! CSP-Erlaubnis als auch passende CORS-Kopfzeilen von GitHub.
//! HttpURLConnection kennt beides nicht.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Muss zum Paketnamen des Kotlin-Teils passen (android/build.gradle.kts,
/// `namespace`).
const PLUGIN_IDENTIFIER: &str = "de.leifsanden.planner.update";

/// Nur was hierunter liegt, darf installiert werden.
///
/// Muss zu ASSET_PREFIX im Kotlin-Teil passen - dort steht dieselbe Pruefung
/// noch einmal. Das ist Absicht: die Rust-Seite ist die, die das Frontend
/// erreicht, die Kotlin-Seite die, die tatsaechlich laedt.
const ASSET_PREFIX: &str = "https://github.com/sandenleif/planner/releases/download/";

// ------------------------------------------------------------------- Daten

/// Gegenstueck zu `updateState()` im Kotlin-Teil.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    /// "idle" | "downloading" | "installing" | "confirm" | "success" |
    /// "cancelled" | "failed"
    pub state: String,
    /// Bereits geladene Bytes.
    pub bytes: i64,
    /// Gesamtgroesse, 0 wenn der Server sie nicht nennt.
    pub total: i64,
    /// Nur bei "failed" gesetzt.
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Der rohe Text von latest.json. Ausgewertet wird im Frontend.
    pub json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanInstall {
    /// Ob der Nutzer dieser App das Installieren erlaubt hat.
    pub allowed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartArgs {
    url: String,
}

/// `invoke.resolve()` schickt ein leeres Objekt; nach `()` liesse sich das
/// nicht deserialisieren.
#[derive(Debug, Serialize, Deserialize)]
struct Empty {}

// ------------------------------------------------------------------ Fehler

#[derive(Debug)]
pub enum Error {
    /// Der Aufruf hat den Kotlin-Teil nicht erreicht oder ist dort gescheitert.
    Bridge(String),
    /// Die Adresse liegt nicht unterhalb der Releases dieses Repositorys.
    UnexpectedUrl(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Bridge(message) => write!(f, "Update-Bruecke: {message}"),
            Error::UnexpectedUrl(url) => {
                write!(f, "Abgelehnt: {url} liegt nicht unter {ASSET_PREFIX}")
            }
        }
    }
}

impl std::error::Error for Error {}

/// Siehe plugins/planner-widget/src/lib.rs - `std::result::Result` steht voll
/// qualifiziert, weil der Alias unten nur einen Typparameter hat.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

// ----------------------------------------------------------------- Zugriff

pub struct PlannerUpdate<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> PlannerUpdate<R> {
    /// Holt latest.json. Die Adresse steht im Kotlin-Teil, es gibt hier also
    /// nichts zu uebergeben und damit auch nichts zu verbiegen.
    pub fn fetch_manifest(&self) -> Result<Manifest> {
        self.call("fetchManifest", Empty {})
    }

    pub fn can_install(&self) -> Result<CanInstall> {
        self.call("canInstall", Empty {})
    }

    /// Oeffnet die Systemeinstellung "Unbekannte Apps installieren".
    pub fn open_install_settings(&self) -> Result<()> {
        self.call::<Empty, _>("openInstallSettings", Empty {})
            .map(|_| ())
    }

    /// Startet Laden und Installieren. Kehrt sofort zurueck; der Fortschritt
    /// steht in `state()`.
    pub fn start_update(&self, url: String) -> Result<()> {
        if !url.starts_with(ASSET_PREFIX) {
            return Err(Error::UnexpectedUrl(url));
        }
        self.call::<Empty, _>("startUpdate", StartArgs { url })
            .map(|_| ())
    }

    pub fn state(&self) -> Result<State> {
        self.call("updateState", Empty {})
    }

    fn call<T: serde::de::DeserializeOwned, A: Serialize>(
        &self,
        command: &str,
        args: A,
    ) -> Result<T> {
        self.0
            .run_mobile_plugin::<T>(command, args)
            .map_err(|error| Error::Bridge(error.to_string()))
    }
}

pub trait PlannerUpdateExt<R: Runtime> {
    fn planner_update(&self) -> &PlannerUpdate<R>;
}

impl<R: Runtime, T: Manager<R>> PlannerUpdateExt<R> for T {
    fn planner_update(&self) -> &PlannerUpdate<R> {
        self.state::<PlannerUpdate<R>>().inner()
    }
}

// ----------------------------------------------------------------- Befehle

/// Der einzige Befehl hier, der wirklich wartet - er haengt an einer
/// Netzverbindung.
///
/// Deshalb `async` und `spawn_blocking`, waehrend die anderen vier schlicht
/// synchron sind: Tauri fuehrt einen synchronen Befehl auf dem Haupt-Thread
/// aus. Eine halbe Sekunde Funkloch liesse damit die gesamte Oberflaeche
/// stehen - und zwar bei jedem Start, denn die Pruefung laeuft von allein.
///
/// `spawn_blocking` und nicht nur `async`: `run_mobile_plugin` wartet
/// blockierend auf die Antwort aus Kotlin. In einem gewoehnlichen
/// async-Befehl belegte dieses Warten einen Arbeits-Thread der Laufzeit, statt
/// ihn freizugeben.
#[tauri::command]
async fn fetch_manifest<R: Runtime>(app: AppHandle<R>) -> Result<Manifest> {
    tauri::async_runtime::spawn_blocking(move || app.planner_update().fetch_manifest())
        .await
        .map_err(|error| Error::Bridge(error.to_string()))?
}

#[tauri::command]
fn can_install<R: Runtime>(app: AppHandle<R>) -> Result<CanInstall> {
    app.planner_update().can_install()
}

#[tauri::command]
fn open_install_settings<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.planner_update().open_install_settings()
}

#[tauri::command]
fn start_update<R: Runtime>(app: AppHandle<R>, url: String) -> Result<()> {
    app.planner_update().start_update(url)
}

#[tauri::command]
fn update_state<R: Runtime>(app: AppHandle<R>) -> Result<State> {
    app.planner_update().state()
}

// ------------------------------------------------------------------ Aufbau

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("planner-update")
        .invoke_handler(tauri::generate_handler![
            fetch_manifest,
            can_install,
            open_install_settings,
            start_update,
            update_state
        ])
        .setup(|app, api| {
            app.manage(register(api)?);
            Ok(())
        })
        .build()
}

fn register<R: Runtime, C: serde::de::DeserializeOwned>(
    api: PluginApi<R, C>,
) -> std::result::Result<PlannerUpdate<R>, Box<dyn std::error::Error>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "PlannerUpdatePlugin")?;
    Ok(PlannerUpdate(handle))
}
