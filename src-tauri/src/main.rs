// Empêche l'ouverture d'une console supplémentaire sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    use_native_window_decorations();

    foxmark_lib::run()
}

/// Décorations de fenêtre natives du bureau.
///
/// Sous Wayland, GTK dessine ses propres décorations client (CSD), au style
/// GNOME/Adwaita — déplacé sous KDE, XFCE, etc. En repassant par XWayland
/// (backend x11), c'est le gestionnaire de fenêtres qui décore : boutons
/// Breeze natifs sous KDE, et cohérents partout ailleurs. Sous GNOME, les
/// CSD sont déjà natifs : on ne touche à rien. Reste surchargeable via
/// GDK_BACKEND.
#[cfg(target_os = "linux")]
fn use_native_window_decorations() {
    let wayland = std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland")
        || std::env::var_os("WAYLAND_DISPLAY").is_some();
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_uppercase();
    let already_set = std::env::var_os("GDK_BACKEND").is_some();

    if wayland && !already_set && !desktop.contains("GNOME") {
        std::env::set_var("GDK_BACKEND", "x11");
    }
}
