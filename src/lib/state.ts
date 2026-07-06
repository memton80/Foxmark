/**
 * state.ts — État applicatif central (onglets, dossier de travail).
 * Petit store observable sans framework : les composants s'abonnent
 * aux changements et se re-rendent eux-mêmes.
 */

export type TabKind = "welcome" | "markdown" | "pdf";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** Chemin absolu du fichier ; null pour un document jamais enregistré. */
  path: string | null;
  /** Contenu courant du buffer (onglets markdown uniquement). */
  content: string;
  modified: boolean;
}

export interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  workspaceDir: string | null;
  sidebarVisible: boolean;
  previewVisible: boolean;
  focusMode: boolean;
}

type Listener = (state: AppState) => void;

let nextId = 1;

class Store {
  private state: AppState = {
    tabs: [],
    activeTabId: null,
    workspaceDir: null,
    sidebarVisible: true,
    // La page d'écriture met le Markdown en forme en direct ; l'aperçu
    // HTML (rendu exact de l'export PDF) s'ouvre à la demande (Ctrl+E).
    previewVisible: false,
    focusMode: false,
  };

  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  activeTab(): Tab | null {
    return this.state.tabs.find((t) => t.id === this.state.activeTabId) ?? null;
  }

  findTabByPath(path: string): Tab | null {
    return this.state.tabs.find((t) => t.path === path) ?? null;
  }

  openTab(partial: Omit<Tab, "id">): Tab {
    const tab: Tab = { ...partial, id: `tab-${nextId++}` };
    this.state = {
      ...this.state,
      tabs: [...this.state.tabs, tab],
      activeTabId: tab.id,
    };
    this.emit();
    return tab;
  }

  setActive(id: string): void {
    if (this.state.activeTabId === id) return;
    this.state = { ...this.state, activeTabId: id };
    this.emit();
  }

  closeTab(id: string): void {
    const index = this.state.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tabs = this.state.tabs.filter((t) => t.id !== id);
    let activeTabId = this.state.activeTabId;
    if (activeTabId === id) {
      const neighbor = tabs[Math.min(index, tabs.length - 1)];
      activeTabId = neighbor ? neighbor.id : null;
    }
    this.state = { ...this.state, tabs, activeTabId };
    this.emit();
  }

  updateTab(id: string, patch: Partial<Tab>): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    };
    this.emit();
  }

  setWorkspace(dir: string | null): void {
    this.state = { ...this.state, workspaceDir: dir };
    this.emit();
  }

  toggleSidebar(): void {
    this.state = { ...this.state, sidebarVisible: !this.state.sidebarVisible };
    this.emit();
  }

  togglePreview(): void {
    this.state = { ...this.state, previewVisible: !this.state.previewVisible };
    this.emit();
  }

  toggleFocusMode(): void {
    this.state = { ...this.state, focusMode: !this.state.focusMode };
    this.emit();
  }
}

export const store = new Store();
