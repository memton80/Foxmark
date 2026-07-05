/**
 * ipc.ts — Couche d'appel typée vers les commands Rust (Tauri invoke).
 *
 * Toute erreur Rust remonte sous forme de chaîne lisible ; les appelants
 * la capturent et l'affichent via un toast (voir components/Toast.ts).
 */
import { invoke } from "@tauri-apps/api/core";

/** Un fichier ouvert (Markdown ou CSS). */
export interface FileDocument {
  path: string;
  content: string;
}

/** Nœud de l'arborescence du dossier de travail. */
export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileNode[];
}

/** Entrée de l'historique des fichiers récents. */
export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

/** Mode de style pour l'export PDF. */
export type CssMode = "github" | "custom" | "overlay";

/** Options d'en-tête / pied de page pour l'export. */
export interface HeaderFooterOptions {
  enabled: boolean;
  showTitle: boolean;
  showDate: boolean;
  showPageNumbers: boolean;
}

/** Arguments de l'export Markdown → PDF. */
export interface ExportArgs {
  source: string;
  docPath: string | null;
  outputPath: string;
  cssMode: CssMode;
  customCssPath: string | null;
  headerFooter: HeaderFooterOptions;
  title: string;
}

/** Résultat du rendu d'une page PDF. */
export interface PdfPageImage {
  data: string;
  width: number;
  height: number;
}

/** Informations générales d'un document PDF. */
export interface PdfInfo {
  pageCount: number;
  title: string | null;
}

/** Occurrence trouvée lors d'une recherche dans un PDF. */
export interface PdfSearchHit {
  pageIndex: number;
  snippet: string;
}

export const ipc = {
  openFile: (path: string) => invoke<FileDocument>("open_file", { path }),

  saveFile: (path: string, content: string) =>
    invoke<void>("save_file", { path, content }),

  listWorkspace: (dir: string) => invoke<FileNode[]>("list_workspace", { dir }),

  listMarkdownFiles: (dir: string) =>
    invoke<string[]>("list_markdown_files", { dir }),

  importImage: (docPath: string, sourcePath: string) =>
    invoke<string>("import_image", { docPath, sourcePath }),

  getRecentFiles: () => invoke<RecentFile[]>("get_recent_files"),

  addRecentFile: (path: string) =>
    invoke<RecentFile[]>("add_recent_file", { path }),

  /**
   * Rend le Markdown en document HTML complet.
   * La MÊME fonction Rust sert à l'aperçu et à l'export PDF, ce qui
   * garantit que l'aperçu affiché correspond exactement au PDF exporté.
   *
   * `urlMode` contrôle la résolution des chemins relatifs (images) :
   * "asset" pour l'aperçu (protocole asset de Tauri), "file" pour l'export.
   */
  renderMarkdown: (
    source: string,
    baseDir: string | null,
    cssHrefs: string[],
    title: string,
    urlMode: "asset" | "file",
  ) =>
    invoke<string>("render_markdown", {
      source,
      baseDir,
      cssHrefs,
      title,
      urlMode,
    }),

  /** Chemins (filesystem) des feuilles de style d'export à appliquer. */
  getExportCssPaths: (cssMode: CssMode, customCssPath: string | null) =>
    invoke<string[]>("get_export_css_paths", { cssMode, customCssPath }),

  exportPdf: (args: ExportArgs) => invoke<string>("export_pdf", { args }),

  pdfInfo: (path: string) => invoke<PdfInfo>("pdf_info", { path }),

  pdfRenderPage: (path: string, pageIndex: number, zoom: number) =>
    invoke<PdfPageImage>("pdf_render_page", { path, pageIndex, zoom }),

  pdfPageText: (path: string, pageIndex: number) =>
    invoke<string>("pdf_page_text", { path, pageIndex }),

  pdfSearch: (path: string, query: string) =>
    invoke<PdfSearchHit[]>("pdf_search", { path, query }),
};
