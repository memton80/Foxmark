//! Foxmark — éditeur Markdown natif inspiré de Firefox.
//!
//! Modules :
//!   - `markdown` : rendu Markdown → HTML (commun aperçu / export) ;
//!   - `export`   : export PDF via Chrome headless ;
//!   - `pdf`      : visionneuse PDF via PDFium ;
//!   - `files`    : fichiers, arborescence, images, récents ;
//!   - `error`    : erreurs sérialisables et lisibles côté UI.

mod error;
mod export;
mod files;
mod markdown;
mod pdf;

/// Fond de la fenêtre GTK posé dès sa création, avant le premier rendu de
/// la webview : supprime le flash noir au démarrage (le splash HTML prend
/// ensuite le relais). Styling GTK natif — le CSS du frontend n'est pas
/// concerné et reste dans src/styles/.
#[cfg(target_os = "linux")]
fn paint_native_window_background(app: &tauri::App) {
    use gtk::prelude::*;
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    let provider = gtk::CssProvider::new();
    // Même couleur que le splash et backgroundColor (thème sombre Proton).
    if provider
        .load_from_data(b"* { background-color: #1c1b22; }")
        .is_ok()
    {
        gtk_window
            .style_context()
            .add_provider(&provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            paint_native_window_background(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::open_file,
            files::save_file,
            files::list_workspace,
            files::list_markdown_files,
            files::import_image,
            files::get_recent_files,
            files::add_recent_file,
            markdown::render_markdown,
            export::get_export_css_paths,
            export::export_pdf,
            pdf::pdf_info,
            pdf::pdf_render_page,
            pdf::pdf_page_text,
            pdf::pdf_search,
        ])
        .run(tauri::generate_context!());

    if let Err(error) = app {
        eprintln!("Erreur fatale au démarrage de Foxmark : {error}");
        std::process::exit(1);
    }
}
