/**
 * main.ts — Point d'entrée du frontend Foxmark.
 * Assemble les composants, gère les onglets, les raccourcis globaux,
 * le glisser-déposer d'images et la sauvegarde automatique.
 */

// Règle du projet : tout le style vit dans des fichiers .css externes.
import "./styles/theme.css";
import "./styles/firefox-proton.css";
import "./styles/tabs.css";
import "./styles/sidebar.css";
import "./styles/editor.css";
import "./styles/preview.css";
import "./styles/pdf-viewer.css";
import "./styles/command-palette.css";
import "./styles/dialogs.css";
import "./styles/toasts.css";
import "./styles/welcome.css";

import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { EditorView } from "@codemirror/view";

import { ipc, type FileNode } from "./lib/ipc";
import { store, type Tab } from "./lib/state";
import {
  basename,
  dirname,
  isImage,
  isMarkdown,
  isPdf,
  relativePath,
} from "./lib/paths";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { createWelcomePane } from "./components/Welcome";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import {
  DEFAULT_EXPORT_SETTINGS,
  ExportDialog,
  type ExportSettings,
} from "./components/ExportDialog";
import { DocumentView } from "./components/DocumentView";
import { PdfViewer } from "./components/PdfViewer";
import { icon } from "./components/icons";
import { showToast, reportError } from "./components/Toast";
import { insertQuote } from "./editor/markdown-commands";

const AUTOSAVE_INTERVAL_MS = 30_000;
const SETTINGS_KEY = "foxmark.exportSettings";
const WORKSPACE_KEY = "foxmark.workspace";
const THEME_KEY = "foxmark.theme";

type TabView =
  | { kind: "markdown"; view: DocumentView }
  | { kind: "pdf"; viewer: PdfViewer; element: HTMLElement }
  | { kind: "welcome"; element: HTMLElement };

class App {
  private content = mustGet("content");
  private views = new Map<string, TabView>();
  private sidebar: Sidebar;
  private palette: CommandPalette;
  private exportDialog: ExportDialog;
  private exportSettings: ExportSettings;
  private workspaceFiles: FileNode[] = [];
  private toolbarTitle!: HTMLElement;

  constructor() {
    this.exportSettings = this.loadExportSettings();
    this.applyStoredTheme();

    new TabBar(mustGet("tab-bar"), {
      onNewTab: () => this.newMarkdownTab(),
      onCloseRequested: (tabId) => void this.closeTab(tabId),
    });

    this.sidebar = new Sidebar(mustGet("sidebar"), {
      onOpenFile: (path) => void this.openPath(path),
      onPickWorkspace: () => void this.pickWorkspace(),
    });

    this.palette = new CommandPalette(mustGet("command-palette-root"), () =>
      this.paletteCommands(),
    );

    this.exportDialog = new ExportDialog(
      mustGet("dialog-root"),
      this.exportSettings,
      (settings) => {
        this.exportSettings = settings;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        this.refreshAllPreviews();
      },
    );

    this.buildToolbar();
    store.subscribe(() => this.syncViews());

    this.registerGlobalShortcuts();
    void this.registerDragAndDrop();
    this.startAutosave();

    const storedWorkspace = localStorage.getItem(WORKSPACE_KEY);
    if (storedWorkspace) {
      store.setWorkspace(storedWorkspace);
      void this.refreshWorkspace();
    }

    this.openWelcomeTab();
  }

  // ------------------------------------------------------------------
  // Construction de l'interface
  // ------------------------------------------------------------------

  private buildToolbar(): void {
    const toolbar = mustGet("toolbar");

    const sidebarBtn = toolbarButton("sidebar", "Panneau latéral (F9)", () =>
      store.toggleSidebar(),
    );

    this.toolbarTitle = document.createElement("span");
    this.toolbarTitle.className = "toolbar-title";

    const spacerLeft = document.createElement("span");
    spacerLeft.className = "toolbar-spacer";
    const spacerRight = document.createElement("span");
    spacerRight.className = "toolbar-spacer";

    const previewBtn = toolbarButton("preview", "Aperçu (Ctrl+E)", () => {
      store.togglePreview();
      this.refreshAllPreviews();
    });
    const focusBtn = toolbarButton("focus", "Mode focus (F11)", () =>
      this.toggleFocusMode(),
    );
    const exportBtn = toolbarButton("export", "Exporter en PDF (Ctrl+Shift+E)", () =>
      this.openExportDialog(),
    );
    const paletteBtn = toolbarButton("command", "Palette de commandes (Ctrl+L)", () =>
      this.palette.toggle(),
    );

    toolbar.append(
      sidebarBtn,
      spacerLeft,
      this.toolbarTitle,
      spacerRight,
      previewBtn,
      focusBtn,
      exportBtn,
      paletteBtn,
    );
  }

  // ------------------------------------------------------------------
  // Synchronisation onglets ↔ vues
  // ------------------------------------------------------------------

  private syncViews(): void {
    const { tabs, activeTabId } = store.get();
    const liveIds = new Set(tabs.map((t) => t.id));

    // Supprime les vues des onglets fermés.
    for (const [tabId, view] of this.views) {
      if (!liveIds.has(tabId)) {
        if (view.kind === "markdown") {
          view.view.destroy();
        } else {
          view.element.remove();
        }
        this.views.delete(tabId);
      }
    }

    // Crée les vues manquantes et gère la visibilité.
    for (const tab of tabs) {
      const view = this.views.get(tab.id) ?? this.createView(tab);
      const element = view.kind === "markdown" ? view.view.element : view.element;
      element.classList.toggle("visible", tab.id === activeTabId);
    }

    const active = store.activeTab();
    this.toolbarTitle.replaceChildren();
    if (active) {
      this.toolbarTitle.append(active.path ?? active.title);
      if (active.modified) {
        const dot = document.createElement("span");
        dot.className = "modified-dot";
        dot.textContent = "●";
        this.toolbarTitle.appendChild(dot);
      }
    }

    if (active && active.kind === "markdown") {
      const view = this.views.get(active.id);
      if (view?.kind === "markdown") {
        view.view.focus();
      }
    }
  }

  private createView(tab: Tab): TabView {
    let view: TabView;
    switch (tab.kind) {
      case "markdown": {
        const docView = new DocumentView(
          tab,
          {
            onSaveRequested: (tabId) => void this.saveTab(tabId),
            exportSettings: () => this.exportSettings,
          },
          this.completionProviders(tab.id),
        );
        docView.element.classList.add("tab-content");
        view = { kind: "markdown", view: docView };
        this.content.appendChild(docView.element);
        break;
      }
      case "pdf": {
        const viewer = new PdfViewer(tab.path ?? "", {
          onQuote: (text) => this.quoteIntoMarkdown(text),
        });
        viewer.element.classList.add("tab-content");
        view = { kind: "pdf", viewer, element: viewer.element };
        this.content.appendChild(viewer.element);
        break;
      }
      case "welcome": {
        const element = createWelcomePane({
          onNewFile: () => this.newMarkdownTab(),
          onOpenFile: () => void this.openFileDialog(),
          onOpenFolder: () => void this.pickWorkspace(),
          onOpenRecent: (path) => void this.openPath(path),
        });
        element.classList.add("tab-content");
        view = { kind: "welcome", element };
        this.content.appendChild(element);
        break;
      }
    }
    this.views.set(tab.id, view);
    return view;
  }

  // ------------------------------------------------------------------
  // Actions sur les onglets / fichiers
  // ------------------------------------------------------------------

  private openWelcomeTab(): void {
    store.openTab({
      kind: "welcome",
      title: "Accueil",
      path: null,
      content: "",
      modified: false,
    });
  }

  private newMarkdownTab(): void {
    store.openTab({
      kind: "markdown",
      title: "Sans titre",
      path: null,
      content: "",
      modified: false,
    });
  }

  async openPath(path: string): Promise<void> {
    const existing = store.findTabByPath(path);
    if (existing) {
      store.setActive(existing.id);
      return;
    }

    try {
      if (isPdf(path)) {
        store.openTab({
          kind: "pdf",
          title: basename(path),
          path,
          content: "",
          modified: false,
        });
      } else {
        const file = await ipc.openFile(path);
        store.openTab({
          kind: "markdown",
          title: basename(path),
          path,
          content: file.content,
          modified: false,
        });
      }
      await ipc.addRecentFile(path);
    } catch (err) {
      reportError(err);
    }
  }

  private async openFileDialog(): Promise<void> {
    const file = await open({
      multiple: false,
      filters: [
        { name: "Documents", extensions: ["md", "markdown", "pdf"] },
        { name: "Tous les fichiers", extensions: ["*"] },
      ],
    });
    if (typeof file === "string") {
      await this.openPath(file);
    }
  }

  private async pickWorkspace(): Promise<void> {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      store.setWorkspace(dir);
      localStorage.setItem(WORKSPACE_KEY, dir);
      await this.refreshWorkspace();
    }
  }

  private async refreshWorkspace(): Promise<void> {
    await this.sidebar.refresh();
    const dir = store.get().workspaceDir;
    if (!dir) {
      this.workspaceFiles = [];
      return;
    }
    try {
      this.workspaceFiles = await ipc.listWorkspace(dir);
    } catch {
      this.workspaceFiles = [];
    }
  }

  private async closeTab(tabId: string): Promise<void> {
    const tab = store.get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.kind === "markdown" && tab.modified) {
      const shouldClose = await ask(
        `« ${tab.title} » contient des modifications non enregistrées.\nFermer sans enregistrer ?`,
        { title: "Foxmark", kind: "warning" },
      );
      if (!shouldClose) return;
    }
    store.closeTab(tabId);
    if (store.get().tabs.length === 0) {
      this.openWelcomeTab();
    }
  }

  async saveTab(tabId: string, saveAs = false): Promise<void> {
    const tab = store.get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "markdown") return;

    let path = tab.path;
    if (!path || saveAs) {
      const suggested = tab.path ?? `${tab.title.replace(/[/\\]/g, "-")}.md`;
      const picked = await save({
        defaultPath: suggested,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!picked) return;
      path = picked;
    }

    try {
      await ipc.saveFile(path, tab.content);
      store.updateTab(tabId, {
        path,
        title: basename(path),
        modified: false,
      });
      await ipc.addRecentFile(path);
      await this.refreshWorkspace();
    } catch (err) {
      reportError(err);
    }
  }

  /** Sauvegarde silencieuse de tous les onglets modifiés déjà nommés. */
  private startAutosave(): void {
    const saveModified = () => {
      for (const tab of store.get().tabs) {
        if (tab.kind === "markdown" && tab.modified && tab.path) {
          ipc
            .saveFile(tab.path, tab.content)
            .then(() => store.updateTab(tab.id, { modified: false }))
            .catch((err) => console.warn("Autosave échouée :", err));
        }
      }
    };
    window.setInterval(saveModified, AUTOSAVE_INTERVAL_MS);
    window.addEventListener("blur", saveModified);
  }

  private quoteIntoMarkdown(text: string): void {
    // Cherche un onglet markdown (l'actif de préférence) pour y insérer la citation.
    const state = store.get();
    const activeMarkdown =
      state.tabs.find(
        (t) => t.id === state.activeTabId && t.kind === "markdown",
      ) ?? state.tabs.find((t) => t.kind === "markdown");

    if (!activeMarkdown) {
      this.newMarkdownTab();
      const created = store.activeTab();
      if (!created) return;
      // La vue vient d'être créée de manière synchrone par syncViews().
      const view = this.views.get(created.id);
      if (view?.kind === "markdown") {
        insertQuote(view.view.editor, text);
      }
      return;
    }

    const view = this.views.get(activeMarkdown.id);
    if (view?.kind === "markdown") {
      store.setActive(activeMarkdown.id);
      insertQuote(view.view.editor, text);
      showToast("Citation insérée.", "success");
    }
  }

  private openExportDialog(): void {
    const tab = store.activeTab();
    if (!tab || tab.kind !== "markdown") {
      showToast("Ouvrez un document Markdown pour l'exporter.", "info");
      return;
    }
    this.exportDialog.open({
      source: tab.content,
      docPath: tab.path,
      title: tab.title.replace(/\.md$/i, ""),
    });
  }

  private toggleFocusMode(): void {
    store.toggleFocusMode();
    document.body.classList.toggle("focus-mode", store.get().focusMode);
  }

  private refreshAllPreviews(): void {
    for (const view of this.views.values()) {
      if (view.kind === "markdown") {
        view.view.schedulePreview();
      }
    }
  }

  // ------------------------------------------------------------------
  // Autocomplétion : fournisseurs de données
  // ------------------------------------------------------------------

  private completionProviders(tabId: string) {
    const docDir = (): string | null => {
      const tab = store.get().tabs.find((t) => t.id === tabId);
      return tab?.path ? dirname(tab.path) : store.get().workspaceDir;
    };

    const flatFiles = (): string[] => {
      const result: string[] = [];
      const walk = (nodes: FileNode[]) => {
        for (const node of nodes) {
          if (node.isDir) {
            walk(node.children);
          } else {
            result.push(node.path);
          }
        }
      };
      walk(this.workspaceFiles);
      return result;
    };

    return {
      markdownFiles: (): string[] => {
        const dir = docDir();
        if (!dir) return [];
        const tab = store.get().tabs.find((t) => t.id === tabId);
        return flatFiles()
          .filter((path) => isMarkdown(path) && path !== tab?.path)
          .map((path) => relativePath(dir, path));
      },
      imageFiles: (): string[] => {
        const dir = docDir();
        if (!dir) return [];
        return flatFiles()
          .filter((path) => isImage(path))
          .map((path) => relativePath(dir, path));
      },
      browseImage: (view: EditorView, from: number, to: number): void => {
        void this.browseAndInsertImage(tabId, view, from, to);
      },
    };
  }

  private async browseAndInsertImage(
    tabId: string,
    view: EditorView,
    from: number,
    to: number,
  ): Promise<void> {
    const tab = store.get().tabs.find((t) => t.id === tabId);
    if (!tab?.path) {
      showToast(
        "Enregistrez d'abord le document pour pouvoir importer des images.",
        "info",
      );
      return;
    }
    const file = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"],
        },
      ],
    });
    if (typeof file !== "string") return;

    try {
      const relPath = await ipc.importImage(tab.path, file);
      const alt = basename(relPath).replace(/\.\w+$/, "");
      view.dispatch({
        changes: { from, to, insert: `![${alt}](${encodeURI(relPath)})` },
      });
      await this.refreshWorkspace();
    } catch (err) {
      reportError(err);
    }
  }

  // ------------------------------------------------------------------
  // Glisser-déposer d'images et de fichiers
  // ------------------------------------------------------------------

  private async registerDragAndDrop(): Promise<void> {
    await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const { paths, position } = event.payload;
      for (const path of paths) {
        if (isImage(path)) {
          void this.dropImage(path, position.x, position.y);
        } else if (isMarkdown(path) || isPdf(path)) {
          void this.openPath(path);
        }
      }
    });
  }

  private async dropImage(
    sourcePath: string,
    physicalX: number,
    physicalY: number,
  ): Promise<void> {
    const tab = store.activeTab();
    if (!tab || tab.kind !== "markdown") return;
    if (!tab.path) {
      showToast(
        "Enregistrez d'abord le document pour pouvoir importer des images.",
        "info",
      );
      return;
    }
    const view = this.views.get(tab.id);
    if (view?.kind !== "markdown") return;

    try {
      // L'image est copiée dans le dossier assets/ relatif au fichier .md.
      const relPath = await ipc.importImage(tab.path, sourcePath);
      const editor = view.view.editor;
      const ratio = window.devicePixelRatio || 1;
      const pos =
        editor.posAtCoords({ x: physicalX / ratio, y: physicalY / ratio }) ??
        editor.state.selection.main.head;
      const alt = basename(relPath).replace(/\.\w+$/, "");
      editor.dispatch({
        changes: { from: pos, insert: `![${alt}](${encodeURI(relPath)})` },
      });
      await this.refreshWorkspace();
    } catch (err) {
      reportError(err);
    }
  }

  // ------------------------------------------------------------------
  // Palette de commandes et raccourcis globaux
  // ------------------------------------------------------------------

  private paletteCommands(): PaletteCommand[] {
    const commands: PaletteCommand[] = [
      {
        id: "new-file",
        label: "Nouveau document",
        hint: "Ctrl+N",
        iconName: "plus",
        action: () => this.newMarkdownTab(),
      },
      {
        id: "open-file",
        label: "Ouvrir un fichier…",
        hint: "Ctrl+O",
        iconName: "document",
        action: () => this.openFileDialog(),
      },
      {
        id: "open-folder",
        label: "Ouvrir un dossier de travail…",
        hint: "Ctrl+Shift+O",
        iconName: "folder",
        action: () => this.pickWorkspace(),
      },
      {
        id: "save",
        label: "Enregistrer",
        hint: "Ctrl+S",
        iconName: "save",
        action: () => {
          const tab = store.activeTab();
          if (tab) return this.saveTab(tab.id);
        },
      },
      {
        id: "save-as",
        label: "Enregistrer sous…",
        hint: "Ctrl+Shift+S",
        iconName: "save",
        action: () => {
          const tab = store.activeTab();
          if (tab) return this.saveTab(tab.id, true);
        },
      },
      {
        id: "export-pdf",
        label: "Exporter en PDF…",
        hint: "Ctrl+Shift+E",
        iconName: "export",
        action: () => this.openExportDialog(),
      },
      {
        id: "toggle-sidebar",
        label: "Afficher / masquer le panneau latéral",
        hint: "F9",
        iconName: "sidebar",
        action: () => store.toggleSidebar(),
      },
      {
        id: "toggle-preview",
        label: "Afficher / masquer l'aperçu",
        hint: "Ctrl+E",
        iconName: "preview",
        action: () => {
          store.togglePreview();
          this.refreshAllPreviews();
        },
      },
      {
        id: "toggle-focus",
        label: "Mode focus (sans distraction)",
        hint: "F11",
        iconName: "focus",
        action: () => this.toggleFocusMode(),
      },
      {
        id: "toggle-theme",
        label: "Basculer le thème (système / clair / sombre)",
        iconName: "command",
        action: () => this.cycleTheme(),
      },
      {
        id: "close-tab",
        label: "Fermer l'onglet",
        hint: "Ctrl+W",
        iconName: "close",
        action: () => {
          const tab = store.activeTab();
          if (tab) return this.closeTab(tab.id);
        },
      },
    ];

    return commands;
  }

  private registerGlobalShortcuts(): void {
    window.addEventListener(
      "keydown",
      (event) => {
        const mod = event.ctrlKey || event.metaKey;
        // Ctrl+S est déjà géré par le keymap CodeMirror quand l'éditeur a
        // le focus : ne pas doubler (double dialogue « Enregistrer sous »).
        const inEditor =
          event.target instanceof Element && event.target.closest(".cm-editor");

        if ((mod && event.key === "l") || (mod && event.shiftKey && event.key === "P")) {
          event.preventDefault();
          this.palette.toggle();
          return;
        }
        if (!mod && event.key === "F9") {
          event.preventDefault();
          store.toggleSidebar();
          return;
        }
        if (!mod && event.key === "F11") {
          event.preventDefault();
          this.toggleFocusMode();
          return;
        }
        if (!mod) return;

        if (event.shiftKey) {
          switch (event.key) {
            case "O":
              event.preventDefault();
              void this.pickWorkspace();
              return;
            case "S":
              event.preventDefault();
              void this.saveActive(true);
              return;
            case "E":
              event.preventDefault();
              this.openExportDialog();
              return;
          }
          return;
        }

        switch (event.key) {
          case "n":
            event.preventDefault();
            this.newMarkdownTab();
            break;
          case "o":
            event.preventDefault();
            void this.openFileDialog();
            break;
          case "s":
            if (inEditor) return;
            event.preventDefault();
            void this.saveActive(false);
            break;
          case "w": {
            event.preventDefault();
            const tab = store.activeTab();
            if (tab) void this.closeTab(tab.id);
            break;
          }
          case "e":
            event.preventDefault();
            store.togglePreview();
            this.refreshAllPreviews();
            break;
          case "PageDown":
            event.preventDefault();
            this.cycleTab(1);
            break;
          case "PageUp":
            event.preventDefault();
            this.cycleTab(-1);
            break;
        }
      },
      { capture: true },
    );
  }

  private async saveActive(saveAs: boolean): Promise<void> {
    const tab = store.activeTab();
    if (tab) await this.saveTab(tab.id, saveAs);
  }

  private cycleTab(delta: number): void {
    const { tabs, activeTabId } = store.get();
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.id === activeTabId);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    store.setActive(next.id);
  }

  // ------------------------------------------------------------------
  // Thème et réglages
  // ------------------------------------------------------------------

  private applyStoredTheme(): void {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }

  private cycleTheme(): void {
    const current = localStorage.getItem(THEME_KEY);
    const next =
      current === "light" ? "dark" : current === "dark" ? null : "light";
    if (next) {
      localStorage.setItem(THEME_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
      showToast(`Thème : ${next === "light" ? "clair" : "sombre"}`, "info");
    } else {
      localStorage.removeItem(THEME_KEY);
      document.documentElement.removeAttribute("data-theme");
      showToast("Thème : synchronisé avec le système", "info");
    }
  }

  private loadExportSettings(): ExportSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        return { ...DEFAULT_EXPORT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {
      // Réglages corrompus : on repart des valeurs par défaut.
    }
    return structuredClone(DEFAULT_EXPORT_SETTINGS);
  }
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable dans index.html`);
  return el;
}

function toolbarButton(
  iconName: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "btn btn-icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(icon(iconName));
  button.addEventListener("click", onClick);
  return button;
}

new App();
