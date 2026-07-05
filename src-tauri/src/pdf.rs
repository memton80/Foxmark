//! Lecture de PDF via PDFium (pdfium-render, liaison dynamique).
//!
//! PDFium n'est pas thread-safe : tous les accès passent par un verrou
//! global. Chaque command rouvre le document — PDFium met la bibliothèque
//! en cache, le coût est marginal et cela évite de garder des handles
//! à durée de vie complexe dans l'état Tauri.

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use pdfium_render::prelude::*;
use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// Verrou global de sérialisation des appels PDFium.
static PDFIUM_LOCK: Mutex<()> = Mutex::new(());

/// Nombre maximal d'occurrences renvoyées par une recherche.
const MAX_SEARCH_HITS: usize = 100;

/// Rayon (en caractères) de l'extrait autour d'une occurrence.
const SNIPPET_RADIUS: usize = 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    pub page_count: u32,
    pub title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageImage {
    /// PNG encodé en base64 (affiché via une data URL côté frontend).
    pub data: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSearchHit {
    pub page_index: u32,
    pub snippet: String,
}

impl From<PdfiumError> for Error {
    fn from(err: PdfiumError) -> Self {
        Error::msg(format!("Erreur PDFium : {err:?}"))
    }
}

/// Localise et charge la bibliothèque PDFium :
///   1. chemin explicite via FOXMARK_PDFIUM_PATH ;
///   2. copie embarquée dans les ressources de l'application ;
///   3. bibliothèque système.
fn bind_pdfium(app: &AppHandle) -> Result<Pdfium> {
    if let Ok(dir) = std::env::var("FOXMARK_PDFIUM_PATH") {
        let path = Pdfium::pdfium_platform_library_name_at_path(&PathBuf::from(&dir));
        if let Ok(bindings) = Pdfium::bind_to_library(&path) {
            return Ok(Pdfium::new(bindings));
        }
    }

    if let Ok(resource_dir) = app.path().resolve("pdfium", BaseDirectory::Resource) {
        let path = Pdfium::pdfium_platform_library_name_at_path(&resource_dir);
        if let Ok(bindings) = Pdfium::bind_to_library(&path) {
            return Ok(Pdfium::new(bindings));
        }
    }

    Pdfium::bind_to_system_library()
        .map(Pdfium::new)
        .map_err(|_| {
            Error::msg(
                "Bibliothèque PDFium introuvable. Exécutez scripts/fetch-pdfium.sh \
                 (elle sera embarquée dans l'application) ou définissez \
                 FOXMARK_PDFIUM_PATH vers le dossier contenant libpdfium.so.",
            )
        })
}

fn lock_pdfium() -> Result<std::sync::MutexGuard<'static, ()>> {
    PDFIUM_LOCK
        .lock()
        .map_err(|_| Error::msg("Accès concurrent à PDFium impossible (verrou empoisonné)."))
}

fn load_document<'a>(pdfium: &'a Pdfium, path: &str) -> Result<PdfDocument<'a>> {
    pdfium
        .load_pdf_from_file(path, None)
        .map_err(|e| Error::msg(format!("Ouverture du PDF « {path} » impossible : {e:?}")))
}

#[tauri::command]
pub fn pdf_info(app: AppHandle, path: String) -> Result<PdfInfo> {
    let _guard = lock_pdfium()?;
    let pdfium = bind_pdfium(&app)?;
    let document = load_document(&pdfium, &path)?;

    let title = document
        .metadata()
        .get(PdfDocumentMetadataTagType::Title)
        .map(|tag| tag.value().to_string())
        .filter(|value| !value.trim().is_empty());

    Ok(PdfInfo {
        page_count: document.pages().len() as u32,
        title,
    })
}

#[tauri::command]
pub fn pdf_render_page(
    app: AppHandle,
    path: String,
    page_index: u32,
    zoom: f32,
) -> Result<PdfPageImage> {
    let _guard = lock_pdfium()?;
    let pdfium = bind_pdfium(&app)?;
    let document = load_document(&pdfium, &path)?;

    let page = document
        .pages()
        .get(page_index as u16)
        .map_err(|_| Error::msg(format!("Page {} introuvable.", page_index + 1)))?;

    // 1.0 = ~96 dpi ; le zoom de l'UI multiplie ce facteur.
    let scale = zoom.clamp(0.2, 5.0) * (96.0 / 72.0);
    let config = PdfRenderConfig::new().scale_page_by_factor(scale);

    let bitmap = page.render_with_config(&config)?;
    let image = bitmap.as_image();
    let width = image.width();
    let height = image.height();

    let mut png_bytes: Vec<u8> = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .map_err(|e| Error::msg(format!("Encodage PNG de la page impossible : {e}")))?;

    Ok(PdfPageImage {
        data: base64::engine::general_purpose::STANDARD.encode(&png_bytes),
        width,
        height,
    })
}

#[tauri::command]
pub fn pdf_page_text(app: AppHandle, path: String, page_index: u32) -> Result<String> {
    let _guard = lock_pdfium()?;
    let pdfium = bind_pdfium(&app)?;
    let document = load_document(&pdfium, &path)?;

    let page = document
        .pages()
        .get(page_index as u16)
        .map_err(|_| Error::msg(format!("Page {} introuvable.", page_index + 1)))?;

    // Liaison explicite : le texte emprunte la page, qui emprunte pdfium ;
    // un temporaire en expression de queue survivrait aux locaux.
    let text = page.text()?.all();
    Ok(text)
}

#[tauri::command]
pub fn pdf_search(app: AppHandle, path: String, query: String) -> Result<Vec<PdfSearchHit>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let _guard = lock_pdfium()?;
    let pdfium = bind_pdfium(&app)?;
    let document = load_document(&pdfium, &path)?;

    let mut hits = Vec::new();
    for (index, page) in document.pages().iter().enumerate() {
        let text = match page.text() {
            Ok(text) => text.all(),
            Err(_) => continue,
        };
        collect_hits(&text, &needle, index as u32, &mut hits);
        if hits.len() >= MAX_SEARCH_HITS {
            hits.truncate(MAX_SEARCH_HITS);
            break;
        }
    }
    Ok(hits)
}

/// Repère chaque occurrence (insensible à la casse) et construit un
/// extrait lisible autour, en travaillant sur des frontières de chars.
fn collect_hits(text: &str, needle: &str, page_index: u32, hits: &mut Vec<PdfSearchHit>) {
    let haystack = text.to_lowercase();
    let chars: Vec<char> = text.chars().collect();
    let lower_chars: Vec<char> = haystack.chars().collect();
    let needle_chars: Vec<char> = needle.chars().collect();

    if needle_chars.is_empty() || lower_chars.len() < needle_chars.len() {
        return;
    }

    let mut position = 0;
    while position + needle_chars.len() <= lower_chars.len() {
        if lower_chars[position..position + needle_chars.len()] == needle_chars[..] {
            let start = position.saturating_sub(SNIPPET_RADIUS);
            let end = (position + needle_chars.len() + SNIPPET_RADIUS).min(chars.len());
            let snippet: String = chars[start..end]
                .iter()
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            hits.push(PdfSearchHit {
                page_index,
                snippet,
            });
            if hits.len() >= MAX_SEARCH_HITS {
                return;
            }
            position += needle_chars.len();
        } else {
            position += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_hits_trouve_sans_casse() {
        let mut hits = Vec::new();
        collect_hits(
            "Le Renard roux saute. le renard dort.",
            "renard",
            3,
            &mut hits,
        );
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].page_index, 3);
        assert!(hits[0].snippet.contains("Renard roux"));
    }

    #[test]
    fn collect_hits_gere_les_accents_multioctets() {
        let mut hits = Vec::new();
        collect_hits("Été après été, l'étang gèle.", "été", 0, &mut hits);
        assert_eq!(hits.len(), 2);
    }
}
