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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
