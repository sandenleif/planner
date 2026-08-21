/// Erzeugt die Berechtigungsdateien zu den Befehlen und meldet den Pfad des
/// Gradle-Teils an tauri-build.
///
/// `COMMANDS` muss zu den Befehlen in src/lib.rs passen.
const COMMANDS: &[&str] = &[
    "fetch_manifest",
    "can_install",
    "open_install_settings",
    "start_update",
    "update_state",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
