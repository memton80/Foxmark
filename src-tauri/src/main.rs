// Empêche l'ouverture d'une console supplémentaire sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    use_native_window_decorations();
    #[cfg(target_os = "linux")]
    disable_webkit_dmabuf_renderer();

    foxmark_lib::run()
}

/// Supprime l'écran noir au démarrage.
///
/// Le moteur de rendu DMA-BUF de WebKitGTK passe 1 à 2 secondes à
/// initialiser le GPU (EGL) au lancement ; pendant ce temps la webview est
/// peinte en noir, quels que soient les fonds définis (bug connu, surtout
/// via XWayland et sur certains pilotes). On bascule sur l'ancien chemin
/// de rendu, immédiat, comme le font la plupart des applications Tauri
/// sur Linux. Surchargeable en définissant la variable soi-même.
#[cfg(target_os = "linux")]
fn disable_webkit_dmabuf_renderer() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
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
