// Empêche l'ouverture d'une console supplémentaire sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    foxmark_lib::run()
}
