// Verhindert unter Windows ein zusaetzliches Konsolenfenster im Release-Build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    planner_lib::run();
}
