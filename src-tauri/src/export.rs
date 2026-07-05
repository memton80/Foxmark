//! Export Markdown → PDF via Chrome/Chromium headless (protocole DevTools).
//!
//! Le HTML imprimé est produit par `markdown::render_document` — la même
//! fonction que l'aperçu — ce qui garantit une fidélité CSS complète
//! (grid, flexbox, polices, `@media print`).

use std::fs;
use std::path::PathBuf;

use headless_chrome::types::PrintToPdfOptions;
use headless_chrome::{Browser, LaunchOptions};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::Deserialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};
use crate::markdown::{render_document, UrlMode};

/// Format papier A4, en pouces (unité du protocole DevTools).
const A4_WIDTH_IN: f64 = 8.27;
const A4_HEIGHT_IN: f64 = 11.69;

const FILE_PATH_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'<')
    .add(b'>')
    .add(b'#')
    .add(b'?');

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CssMode {
    /// Thème GitHub par défaut.
    Github,
    /// CSS personnalisé en remplacement complet.
    Custom,
    /// CSS personnalisé appliqué par-dessus le thème GitHub.
    Overlay,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFooterOptions {
    pub enabled: bool,
    pub show_title: bool,
    pub show_date: bool,
    pub show_page_numbers: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    /// Source Markdown (le buffer courant, peut être non enregistré).
    pub source: String,
    /// Chemin du document (résolution des images relatives), s'il existe.
    pub doc_path: Option<String>,
    /// Chemin du PDF à produire.
    pub output_path: String,
    pub css_mode: CssMode,
    pub custom_css_path: Option<String>,
    pub header_footer: HeaderFooterOptions,
    pub title: String,
}

/// Chemin de la feuille de style GitHub embarquée dans les ressources.
fn github_css_path(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .resolve("export-css/github-default.css", BaseDirectory::Resource)
        .map_err(|e| Error::msg(format!("Feuille de style GitHub introuvable : {e}")))
}

/// Feuilles de style (chemins filesystem) à appliquer pour un mode donné.
/// Utilisée par l'aperçu (command ci-dessous) ET par l'export : les deux
/// voient donc exactement les mêmes CSS.
pub fn resolve_css_paths(
    app: &AppHandle,
    mode: CssMode,
    custom_css_path: Option<&str>,
) -> Result<Vec<PathBuf>> {
    let custom = || -> Result<PathBuf> {
        let path = custom_css_path
            .ok_or_else(|| Error::msg("Aucun fichier CSS personnalisé n'a été choisi."))?;
        let path = PathBuf::from(path);
        if !path.is_file() {
            return Err(Error::msg(format!(
                "Le fichier CSS « {} » n'existe pas.",
                path.display()
            )));
        }
        Ok(path)
    };

    Ok(match mode {
        CssMode::Github => vec![github_css_path(app)?],
        CssMode::Custom => vec![custom()?],
        CssMode::Overlay => vec![github_css_path(app)?, custom()?],
    })
}

#[tauri::command]
pub fn get_export_css_paths(
    app: AppHandle,
    css_mode: CssMode,
    custom_css_path: Option<String>,
) -> Result<Vec<String>> {
    Ok(
        resolve_css_paths(&app, css_mode, custom_css_path.as_deref())?
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
    )
}

fn file_url(path: &std::path::Path) -> String {
    format!(
        "file://{}",
        utf8_percent_encode(&path.to_string_lossy(), FILE_PATH_SET)
    )
}

/// Templates d'en-tête/pied de page pour Chrome.
///
/// EXCEPTION DOCUMENTÉE à la règle « pas de CSS dans le HTML » : le
/// protocole DevTools exige des templates autonomes — les feuilles de
/// style externes du document ne leur sont pas appliquées et sans
/// `font-size` explicite ils sont illisibles. Ces fragments sont générés
/// ici, côté Rust, pour l'impression uniquement ; ils ne font pas partie
/// du HTML de l'application ni du document rendu.
fn header_footer_templates(options: &HeaderFooterOptions) -> (String, String) {
    const TEMPLATE_STYLE: &str =
        "font-size:9px;color:#8f8f9d;width:100%;padding:0 16mm;display:flex;\
         justify-content:space-between;font-family:sans-serif;";

    let header = if options.show_title || options.show_date {
        let title = if options.show_title {
            "<span class=\"title\"></span>"
        } else {
            "<span></span>"
        };
        let date = if options.show_date {
            "<span class=\"date\"></span>"
        } else {
            "<span></span>"
        };
        format!("<div style=\"{TEMPLATE_STYLE}\">{title}{date}</div>")
    } else {
        // Template vide : Chrome n'affiche rien mais réserve la marge.
        "<span></span>".to_string()
    };

    let footer = if options.show_page_numbers {
        format!(
            "<div style=\"{TEMPLATE_STYLE}justify-content:center;\">\
             <span><span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></span>\
             </div>"
        )
    } else {
        "<span></span>".to_string()
    };

    (header, footer)
}

#[tauri::command]
pub fn export_pdf(app: AppHandle, args: ExportArgs) -> Result<String> {
    // 1. Feuilles de style → URLs file:// pour Chrome.
    let css_paths = resolve_css_paths(&app, args.css_mode, args.custom_css_path.as_deref())?;
    let css_hrefs: Vec<String> = css_paths.iter().map(|p| file_url(p)).collect();

    // 2. Rendu HTML par LA fonction commune aperçu/export.
    let base_dir = args
        .doc_path
        .as_deref()
        .and_then(|p| std::path::Path::new(p).parent().map(PathBuf::from));
    let html = render_document(
        &args.source,
        base_dir.as_deref(),
        &css_hrefs,
        &args.title,
        UrlMode::File,
    );

    // 3. Document temporaire servi à Chrome en file:// (les URLs relatives
    //    du document ont déjà été résolues en absolu par le rendu).
    let temp_path = std::env::temp_dir().join(format!(
        "foxmark-export-{}-{}.html",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    fs::write(&temp_path, &html)
        .map_err(|e| Error::msg(format!("Écriture du HTML temporaire impossible : {e}")))?;

    let result = print_with_chrome(&temp_path, &args);
    let _ = fs::remove_file(&temp_path);
    result?;

    Ok(args.output_path)
}

fn print_with_chrome(temp_html: &std::path::Path, args: &ExportArgs) -> Result<()> {
    let launch_options = LaunchOptions::default_builder()
        .headless(true)
        .build()
        .map_err(|e| Error::msg(format!("Options de lancement Chrome invalides : {e}")))?;

    let browser = Browser::new(launch_options).map_err(|e| {
        Error::msg(format!(
            "Chrome/Chromium introuvable ou impossible à lancer ({e}). \
             Sur Fedora : sudo dnf install chromium"
        ))
    })?;

    let tab = browser
        .new_tab()
        .map_err(|e| Error::msg(format!("Ouverture d'un onglet Chrome impossible : {e}")))?;

    tab.navigate_to(&file_url(temp_html))
        .and_then(|t| t.wait_until_navigated())
        .map_err(|e| {
            Error::msg(format!(
                "Chargement du document dans Chrome impossible : {e}"
            ))
        })?;

    let (header_template, footer_template) = header_footer_templates(&args.header_footer);
    let display_header_footer = args.header_footer.enabled;

    let pdf_options = PrintToPdfOptions {
        display_header_footer: Some(display_header_footer),
        print_background: Some(true),
        prefer_css_page_size: Some(false),
        paper_width: Some(A4_WIDTH_IN),
        paper_height: Some(A4_HEIGHT_IN),
        margin_top: Some(if display_header_footer { 0.7 } else { 0.4 }),
        margin_bottom: Some(if display_header_footer { 0.7 } else { 0.4 }),
        margin_left: Some(0.5),
        margin_right: Some(0.5),
        header_template: Some(header_template),
        footer_template: Some(footer_template),
        ..Default::default()
    };

    let pdf_bytes = tab
        .print_to_pdf(Some(pdf_options))
        .map_err(|e| Error::msg(format!("Impression PDF impossible : {e}")))?;

    fs::write(&args.output_path, pdf_bytes).map_err(|e| {
        Error::msg(format!(
            "Écriture du PDF « {} » impossible : {e}",
            args.output_path
        ))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates_en_tete_selon_options() {
        let options = HeaderFooterOptions {
            enabled: true,
            show_title: true,
            show_date: false,
            show_page_numbers: true,
        };
        let (header, footer) = header_footer_templates(&options);
        assert!(header.contains("class=\"title\""));
        assert!(!header.contains("class=\"date\""));
        assert!(footer.contains("pageNumber"));
    }

    #[test]
    fn url_file_encode_les_espaces() {
        let url = file_url(std::path::Path::new("/tmp/mon doc.html"));
        assert_eq!(url, "file:///tmp/mon%20doc.html");
    }
}
