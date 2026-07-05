/**
 * TabBar.ts — Barre d'onglets arrondie façon Firefox Proton.
 */
import { store, type Tab } from "../lib/state";
import { icon } from "./icons";

export interface TabBarCallbacks {
  onNewTab(): void;
  onCloseRequested(tabId: string): void;
}

export class TabBar {
  private root: HTMLElement;

  constructor(root: HTMLElement, private callbacks: TabBarCallbacks) {
    this.root = root;
    store.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const { tabs, activeTabId } = store.get();
    this.root.replaceChildren();

    for (const tab of tabs) {
      this.root.appendChild(this.renderTab(tab, tab.id === activeTabId));
    }

    const newTab = document.createElement("button");
    newTab.className = "tab-new";
    newTab.setAttribute("aria-label", "Nouvel onglet");
    newTab.title = "Nouvel onglet (Ctrl+N)";
    newTab.appendChild(icon("plus"));
    newTab.addEventListener("click", () => this.callbacks.onNewTab());
    this.root.appendChild(newTab);
  }

  private renderTab(tab: Tab, active: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = active ? "tab active" : "tab";
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    el.title = tab.path ?? tab.title;

    const tabIcon = document.createElement("span");
    tabIcon.className = "tab-icon";
    tabIcon.appendChild(icon(tab.kind === "pdf" ? "pdf" : "document"));

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.title;

    const modified = document.createElement("span");
    modified.className = tab.modified ? "tab-modified" : "tab-modified hidden";

    const close = document.createElement("button");
    close.className = "tab-close";
    close.setAttribute("aria-label", `Fermer ${tab.title}`);
    close.appendChild(icon("close"));
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks.onCloseRequested(tab.id);
    });

    el.append(tabIcon, label, modified, close);
    el.addEventListener("click", () => store.setActive(tab.id));
    el.addEventListener("auxclick", (event) => {
      if (event.button === 1) this.callbacks.onCloseRequested(tab.id);
    });
    return el;
  }
}
