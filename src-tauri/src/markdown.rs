//! Rendu Markdown → HTML.
//!
//! POINT CLÉ DE L'ARCHITECTURE : `render_document` est LA fonction de rendu,
//! utilisée à la fois par l'aperçu live (command `render_markdown`) et par
//! l'export PDF (`export.rs`). L'aperçu affiché correspond donc exactement
//! au PDF exporté — seule la résolution des URLs relatives change
//! (protocole `asset:` de Tauri pour l'aperçu, `file://` pour Chrome).

use std::collections::HashMap;
use std::path::Path;

use percent_encoding::{
    percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS, NON_ALPHANUMERIC,
};
use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag, TagEnd};
use unicode_normalization::UnicodeNormalization;

use crate::error::{Error, Result};

/// Mode de résolution des chemins relatifs (images) du document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrlMode {
    /// Aperçu dans la webview : protocole `asset://` de Tauri.
    Asset,
    /// Export via Chrome headless : URLs `file://`.
    File,
}

impl UrlMode {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "asset" => Ok(UrlMode::Asset),
            "file" => Ok(UrlMode::File),
            other => Err(Error::msg(format!("Mode d'URL inconnu : {other}"))),
        }
    }
}

/// Caractères à encoder dans un chemin d'URL `file://` (on garde les `/`).
const FILE_PATH_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'<')
    .add(b'>')
    .add(b'`')
    .add(b'#')
    .add(b'?')
    .add(b'{')
    .add(b'}');

/// Slug d'ancre pour un titre — même algorithme que `slugify` côté
/// frontend (src/editor/autocomplete.ts) : minuscules, accents retirés
/// (NFKD), caractères non alphanumériques supprimés, espaces → tirets.
pub fn slugify(text: &str) -> String {
    let lowered = text.to_lowercase();
    let without_marks: String = lowered
        .nfkd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect();
    let cleaned: String = without_marks
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || c.is_whitespace() || *c == '-')
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join("-")
}

fn gfm_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
        | Options::ENABLE_SMART_PUNCTUATION
}

/// Une URL est « relative au document » si elle n'a ni schéma, ni ancre,
/// ni racine absolue.
fn is_relative_url(url: &str) -> bool {
    !url.is_empty()
        && !url.starts_with('/')
        && !url.starts_with('#')
        && !url.contains("://")
        && !url.starts_with("data:")
        && !url.starts_with("mailto:")
}

/// Résout une URL relative d'image vers une URL absolue selon le mode.
fn resolve_relative_url(url: &str, base_dir: &Path, mode: UrlMode) -> String {
    let decoded = percent_decode_str(url).decode_utf8_lossy();
    let absolute = base_dir.join(decoded.as_ref());
    let path_str = absolute.to_string_lossy();
    match mode {
        // Même encodage que `convertFileSrc` côté JS : chemin complet
        // percent-encodé en un seul segment.
        UrlMode::Asset => format!(
            "asset://localhost/{}",
            utf8_percent_encode(&path_str, NON_ALPHANUMERIC)
        ),
        UrlMode::File => format!("file://{}", utf8_percent_encode(&path_str, FILE_PATH_SET)),
    }
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Convertit le Markdown en corps HTML, en ajoutant des ancres (`id`) aux
/// titres et en résolvant les URLs relatives des images.
fn render_body(source: &str, base_dir: Option<&Path>, mode: UrlMode) -> String {
    let mut events: Vec<Event> = Parser::new_ext(source, gfm_options()).collect();

    // 1. Ancres de titres : id = slug du texte, dédupliqué par suffixe -n.
    let mut used_slugs: HashMap<String, usize> = HashMap::new();
    for index in 0..events.len() {
        let needs_id = matches!(&events[index], Event::Start(Tag::Heading { id: None, .. }));
        if !needs_id {
            continue;
        }

        let mut text = String::new();
        for event in events.iter().skip(index + 1) {
            match event {
                Event::End(TagEnd::Heading(_)) => break,
                Event::Text(t) | Event::Code(t) => text.push_str(t),
                _ => {}
            }
        }

        let base_slug = slugify(&text);
        if base_slug.is_empty() {
            continue;
        }
        let count = used_slugs.entry(base_slug.clone()).or_insert(0);
        let slug = if *count == 0 {
            base_slug.clone()
        } else {
            format!("{base_slug}-{count}")
        };
        *count += 1;

        if let Event::Start(Tag::Heading { id, .. }) = &mut events[index] {
            *id = Some(CowStr::from(slug));
        }
    }

    // 2. Résolution des URLs relatives des images.
    if let Some(base) = base_dir {
        for event in &mut events {
            if let Event::Start(Tag::Image { dest_url, .. }) = event {
                if is_relative_url(dest_url) {
                    *dest_url = CowStr::from(resolve_relative_url(dest_url, base, mode));
                }
            }
        }
    }

    let mut body = String::with_capacity(source.len() * 2);
    html::push_html(&mut body, events.into_iter());
    body
}

/// Rend un document HTML complet et autonome : c'est ce document qui est
/// affiché dans l'iframe d'aperçu ET imprimé en PDF par Chrome headless.
///
/// Conformément à la règle du projet, aucun style n'est écrit dans le
/// HTML : les feuilles de style sont référencées par des `<link>` externes.
pub fn render_document(
    source: &str,
    base_dir: Option<&Path>,
    css_hrefs: &[String],
    title: &str,
    mode: UrlMode,
) -> String {
    let body = render_body(source, base_dir, mode);
    let links: String = css_hrefs
        .iter()
        .map(|href| format!("<link rel=\"stylesheet\" href=\"{}\">\n", escape_html(href)))
        .collect();

    format!(
        "<!doctype html>\n<html lang=\"fr\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{}</title>\n{}</head>\n<body>\n\
         <article class=\"markdown-body\">\n{}\n</article>\n</body>\n</html>\n",
        escape_html(title),
        links,
        body
    )
}

/// Command Tauri : rendu du Markdown pour l'aperçu (ou tout autre usage UI).
#[tauri::command]
pub fn render_markdown(
    source: String,
    base_dir: Option<String>,
    css_hrefs: Vec<String>,
    title: String,
    url_mode: String,
) -> Result<String> {
    let mode = UrlMode::parse(&url_mode)?;
    let base = base_dir.map(std::path::PathBuf::from);
    Ok(render_document(
        &source,
        base.as_deref(),
        &css_hrefs,
        &title,
        mode,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_sont_normalises() {
        assert_eq!(slugify("Écriture & Style !"), "ecriture-style");
        assert_eq!(slugify("  Déjà   vu  "), "deja-vu");
        assert_eq!(slugify("Section 2.1"), "section-21");
    }

    #[test]
    fn tables_gfm_sont_rendues() {
        let html = render_body("| a | b |\n|---|---|\n| 1 | 2 |", None, UrlMode::File);
        assert!(html.contains("<table>"));
        assert!(html.contains("<td>1</td>"));
    }

    #[test]
    fn taches_et_barre_sont_rendues() {
        let html = render_body(
            "- [x] fait\n- [ ] à faire\n\n~~barré~~",
            None,
            UrlMode::File,
        );
        assert!(html.contains("checkbox"));
        assert!(html.contains("<del>barré</del>"));
    }

    #[test]
    fn notes_de_bas_de_page_sont_rendues() {
        let html = render_body("corps[^1]\n\n[^1]: la note", None, UrlMode::File);
        assert!(html.contains("footnote"));
    }

    #[test]
    fn titres_recoivent_des_ancres_dedupliquees() {
        let html = render_body("# Intro\n\n## Intro\n", None, UrlMode::File);
        assert!(html.contains("<h1 id=\"intro\">"));
        assert!(html.contains("<h2 id=\"intro-1\">"));
    }

    #[test]
    fn images_relatives_sont_resolues_en_file_url() {
        let html = render_body(
            "![logo](assets/logo.png)",
            Some(Path::new("/home/doc")),
            UrlMode::File,
        );
        assert!(html.contains("src=\"file:///home/doc/assets/logo.png\""));
    }

    #[test]
    fn images_relatives_sont_resolues_en_asset_url() {
        let html = render_body(
            "![logo](assets/logo.png)",
            Some(Path::new("/home/doc")),
            UrlMode::Asset,
        );
        assert!(html.contains("asset://localhost/"));
        assert!(html.contains("%2Fhome%2Fdoc%2Fassets%2Flogo%2Epng"));
    }

    #[test]
    fn urls_absolues_sont_conservees() {
        let html = render_body(
            "![badge](https://img.shields.io/badge/x-y-blue)",
            Some(Path::new("/home/doc")),
            UrlMode::File,
        );
        assert!(html.contains("https://img.shields.io/badge/x-y-blue"));
    }

    #[test]
    fn document_complet_reference_les_css_en_liens_externes() {
        let doc = render_document(
            "# Titre",
            None,
            &["file:///tmp/a.css".to_string()],
            "Mon doc",
            UrlMode::File,
        );
        assert!(doc.contains("<link rel=\"stylesheet\" href=\"file:///tmp/a.css\">"));
        assert!(doc.contains("<title>Mon doc</title>"));
        assert!(doc.contains("class=\"markdown-body\""));
        // Règle du projet : pas de <style> inline dans le document généré.
        assert!(!doc.contains("<style"));
    }
}
