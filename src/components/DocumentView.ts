/**
 * DocumentView.ts — Vue scindée d'un document Markdown :
 * éditeur CodeMirror à gauche, aperçu live à droite.
 *
 * L'aperçu est une iframe dont le document complet provient de la
 * commande Rust `render_markdown` — la même que celle de l'export PDF.
 */
import type { EditorView } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { createEditor } from "../editor/setup";
import type { CompletionProviders } from "../editor/autocomplete";
import { ipc } from "../lib/ipc";
import { store, type Tab } from "../lib/state";
import { dirname } from "../lib/paths";
import type { ExportSettings } from "./ExportDialog";
import { reportError } from "./Toast";

const PREVIEW_DEBOUNCE_MS = 200;

export interface DocumentViewCallbacks {
  onSaveRequested(tabId: string): void;
  exportSettings(): ExportSettings;
}

export class DocumentView {
  readonly element: HTMLElement;
  readonly editor: EditorView;
  private tabId: string;
  private previewFrame: HTMLIFrameElement;
  private previewPane: HTMLElement;
  private debounceTimer: number | null = null;
  private callbacks: DocumentViewCallbacks;
  private unsubscribe: () => void;

  constructor(
    tab: Tab,
    callbacks: DocumentViewCallbacks,
    providers: CompletionProviders,
  ) {
    this.tabId = tab.id;
    this.callbacks = callbacks;

    this.element = document.createElement("div");
    this.element.className = "split-view";

    const editorPane = document.createElement("div");
    editorPane.className = "editor-pane";
    const editorHost = document.createElement("div");
    editorHost.className = "editor-host";
    editorPane.appendChild(editorHost);

    this.previewPane = document.createElement("div");
    this.previewPane.className = "preview-pane";
    this.previewFrame = document.createElement("iframe");
    this.previewFrame.className = "preview-frame";
    this.previewFrame.setAttribute("title", "Aperçu du document");
    this.previewPane.appendChild(this.previewFrame);

    this.element.append(editorPane, this.previewPane);

    this.editor = createEditor(
      editorHost,
      tab.content,
      {
        onChange: (content) => {
          store.updateTab(this.tabId, { content, modified: true });
          this.schedulePreview();
        },
        onSaveRequested: () => this.callbacks.onSaveRequested(this.tabId),
      },
      providers,
    );

    this.unsubscribe = store.subscribe((state) => {
      this.previewPane.classList.toggle("hidden", !state.previewVisible);
    });
    this.previewPane.classList.toggle("hidden", !store.get().previewVisible);

    void this.renderPreview();
  }

  focus(): void {
    this.editor.focus();
  }

  schedulePreview(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.renderPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  async renderPreview(): Promise<void> {
    if (!store.get().previewVisible) return;
    const tab = store.get().tabs.find((t) => t.id === this.tabId);
    if (!tab) return;

    try {
      const settings = this.callbacks.exportSettings();
      // Tant qu'aucun fichier personnalisé n'est choisi, l'aperçu retombe
      // sur le thème GitHub plutôt que d'afficher une erreur en boucle.
      const cssMode =
        settings.cssMode !== "github" && !settings.customCssPath
          ? "github"
          : settings.cssMode;
      const cssPaths = await ipc.getExportCssPaths(
        cssMode,
        settings.customCssPath,
      );
      const cssHrefs = cssPaths.map((path) => convertFileSrc(path));
      const html = await ipc.renderMarkdown(
        tab.content,
        tab.path ? dirname(tab.path) : null,
        cssHrefs,
        tab.title,
        "asset",
      );
      this.previewFrame.srcdoc = html;
    } catch (err) {
      reportError(err);
    }
  }

  destroy(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.unsubscribe();
    this.editor.destroy();
    this.element.remove();
  }
}
