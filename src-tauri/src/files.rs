//! Commands de gestion de fichiers : ouverture, sauvegarde, arborescence
//! du dossier de travail, import d'images et historique des fichiers récents.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// Extensions affichées dans l'arborescence du dossier de travail.
const TREE_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "pdf", "css", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif",
];

/// Dossiers ignorés lors du parcours.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", ".git"];

const MAX_TREE_DEPTH: usize = 6;
const MAX_RECENT_FILES: usize = 15;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDocument {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub opened_at: i64,
}

#[tauri::command]
pub fn open_file(path: String) -> Result<FileDocument> {
    let content = fs::read_to_string(&path)
        .map_err(|e| Error::msg(format!("Impossible de lire « {path} » : {e}")))?;
    Ok(FileDocument { path, content })
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<()> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| Error::msg(format!("Impossible de créer le dossier parent : {e}")))?;
    }
    fs::write(&path, content)
        .map_err(|e| Error::msg(format!("Impossible d'enregistrer « {path} » : {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn list_workspace(dir: String) -> Result<Vec<FileNode>> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(Error::msg(format!("« {dir} » n'est pas un dossier.")));
    }
    walk_dir(&root, 0)
}

/// Liste (chemins absolus) des fichiers Markdown du dossier, pour les
/// liens wiki de l'autocomplétion.
#[tauri::command]
pub fn list_markdown_files(dir: String) -> Result<Vec<String>> {
    fn collect(nodes: &[FileNode], out: &mut Vec<String>) {
        for node in nodes {
            if node.is_dir {
                collect(&node.children, out);
            } else if Path::new(&node.path)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| matches!(e.to_lowercase().as_str(), "md" | "markdown" | "mdown"))
            {
                out.push(node.path.clone());
            }
        }
    }
    let tree = list_workspace(dir)?;
    let mut files = Vec::new();
    collect(&tree, &mut files);
    Ok(files)
}

fn walk_dir(dir: &Path, depth: usize) -> Result<Vec<FileNode>> {
    if depth > MAX_TREE_DEPTH {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(dir)
        .map_err(|e| Error::msg(format!("Lecture impossible de {} : {e}", dir.display())))?;

    let mut dirs: Vec<FileNode> = Vec::new();
    let mut files: Vec<FileNode> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            let children = walk_dir(&path, depth + 1)?;
            // Les dossiers vides (sans fichier pertinent) sont omis.
            if !children.is_empty() {
                dirs.push(FileNode {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir: true,
                    children,
                });
            }
        } else {
            let extension = path
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_lowercase);
            if extension.is_some_and(|e| TREE_EXTENSIONS.contains(&e.as_str())) {
                files.push(FileNode {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir: false,
                    children: Vec::new(),
                });
            }
        }
    }

    dirs.sort_by_key(|node| node.name.to_lowercase());
    files.sort_by_key(|node| node.name.to_lowercase());
    dirs.extend(files);
    Ok(dirs)
}

/// Copie une image dans le dossier `assets/` relatif au document Markdown
/// et renvoie le chemin relatif à insérer dans le texte.
#[tauri::command]
pub fn import_image(doc_path: String, source_path: String) -> Result<String> {
    let doc = PathBuf::from(&doc_path);
    let doc_dir = doc
        .parent()
        .ok_or_else(|| Error::msg("Le document n'a pas de dossier parent."))?;
    let source = PathBuf::from(&source_path);
    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| Error::msg("Nom de fichier d'image invalide."))?;

    let assets_dir = doc_dir.join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|e| Error::msg(format!("Impossible de créer le dossier assets/ : {e}")))?;

    // Évite d'écraser un fichier existant : suffixe -1, -2, …
    let (stem, extension) = match file_name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (file_name.to_string(), String::new()),
    };
    let mut candidate = assets_dir.join(file_name);
    let mut counter = 1;
    while candidate.exists() {
        candidate = assets_dir.join(format!("{stem}-{counter}{extension}"));
        counter += 1;
    }

    fs::copy(&source, &candidate)
        .map_err(|e| Error::msg(format!("Copie de l'image impossible : {e}")))?;

    let copied_name = candidate
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| Error::msg("Nom de fichier copié invalide."))?;
    Ok(format!("assets/{copied_name}"))
}

// ----------------------------------------------------------------------
// Fichiers récents (persistés en JSON dans le dossier de config de l'app)
// ----------------------------------------------------------------------

fn recents_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| Error::msg(format!("Dossier de configuration introuvable : {e}")))?;
    fs::create_dir_all(&dir)
        .map_err(|e| Error::msg(format!("Impossible de créer {} : {e}", dir.display())))?;
    Ok(dir.join("recent-files.json"))
}

fn load_recents(app: &AppHandle) -> Result<Vec<RecentFile>> {
    let path = recents_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

#[tauri::command]
pub fn get_recent_files(app: AppHandle) -> Result<Vec<RecentFile>> {
    load_recents(&app)
}

#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String) -> Result<Vec<RecentFile>> {
    let mut recents = load_recents(&app)?;
    recents.retain(|r| r.path != path);

    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    recents.insert(
        0,
        RecentFile {
            path,
            name,
            opened_at: chrono::Utc::now().timestamp_millis(),
        },
    );
    recents.truncate(MAX_RECENT_FILES);

    let serialized = serde_json::to_string_pretty(&recents).map_err(|e| {
        Error::msg(format!(
            "Sérialisation des fichiers récents impossible : {e}"
        ))
    })?;
    fs::write(recents_path(&app)?, serialized)?;
    Ok(recents)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_image_copie_dans_assets_sans_ecraser() {
        let dir = std::env::temp_dir().join(format!("foxmark-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let doc = dir.join("note.md");
        fs::write(&doc, "# test").unwrap();
        let image = dir.join("photo.png");
        fs::write(&image, b"fake-png").unwrap();

        let first = import_image(
            doc.to_string_lossy().to_string(),
            image.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(first, "assets/photo.png");

        let second = import_image(
            doc.to_string_lossy().to_string(),
            image.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(second, "assets/photo-1.png");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_workspace_filtre_et_trie() {
        let dir = std::env::temp_dir().join(format!("foxmark-tree-{}", std::process::id()));
        let sub = dir.join("notes");
        fs::create_dir_all(&sub).unwrap();
        fs::write(dir.join("b.md"), "b").unwrap();
        fs::write(dir.join("a.md"), "a").unwrap();
        fs::write(dir.join("binaire.exe"), "x").unwrap();
        fs::write(sub.join("c.pdf"), "c").unwrap();

        let tree = list_workspace(dir.to_string_lossy().to_string()).unwrap();
        // Dossier d'abord, puis fichiers triés ; l'exe est filtré.
        assert_eq!(tree.len(), 3);
        assert!(tree[0].is_dir);
        assert_eq!(tree[1].name, "a.md");
        assert_eq!(tree[2].name, "b.md");

        fs::remove_dir_all(&dir).unwrap();
    }
}
