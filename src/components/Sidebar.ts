/**
 * Sidebar.ts — Arborescence rétractable du dossier de travail.
 */
import { ipc, type FileNode } from "../lib/ipc";
import { store } from "../lib/state";
import { basename, isMarkdown, isPdf } from "../lib/paths";
import { icon } from "./icons";
import { reportError } from "./Toast";

export interface SidebarCallbacks {
  onOpenFile(path: string): void;
  onPickWorkspace(): void;
}

export class Sidebar {
  private root: HTMLElement;
  private tree: FileNode[] = [];

  constructor(root: HTMLElement, private callbacks: SidebarCallbacks) {
    this.root = root;
    store.subscribe((state) => {
      this.root.classList.toggle("collapsed", !state.sidebarVisible);
    });
    this.render();
  }

  /** Recharge l'arborescence depuis le dossier de travail courant. */
  async refresh(): Promise<void> {
    const dir = store.get().workspaceDir;
    if (!dir) {
      this.tree = [];
      this.render();
      return;
    }
    try {
      this.tree = await ipc.listWorkspace(dir);
    } catch (err) {
      reportError(err);
      this.tree = [];
    }
    this.render();
  }

  private render(): void {
    const dir = store.get().workspaceDir;
    this.root.replaceChildren();

    const header = document.createElement("div");
    header.className = "sidebar-header";
    const name = document.createElement("span");
    name.className = "workspace-name";
    name.textContent = dir ? basename(dir) : "Aucun dossier";
    header.appendChild(name);
    this.root.appendChild(header);

    if (!dir) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      const hint = document.createElement("span");
      hint.textContent =
        "Ouvrez un dossier pour parcourir vos fichiers Markdown et PDF.";
      const button = document.createElement("button");
      button.className = "btn btn-primary";
      button.textContent = "Ouvrir un dossier…";
      button.addEventListener("click", () => this.callbacks.onPickWorkspace());
      empty.append(hint, button);
      this.root.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "file-tree";
    for (const node of this.tree) {
      list.appendChild(this.renderNode(node));
    }
    this.root.appendChild(list);
  }

  private renderNode(node: FileNode): HTMLElement {
    const li = document.createElement("li");

    const item = document.createElement("div");
    item.className = "tree-item";
    item.title = node.path;

    if (node.isDir) {
      li.className = "tree-dir";
      const caret = document.createElement("span");
      caret.className = "tree-caret";
      caret.appendChild(icon("caret"));
      item.appendChild(caret);
      item.appendChild(icon("folder"));
    } else {
      item.appendChild(icon(isPdf(node.path) ? "pdf" : "document"));
    }

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;
    item.appendChild(label);
    li.appendChild(item);

    if (node.isDir) {
      const children = document.createElement("ul");
      for (const child of node.children) {
        children.appendChild(this.renderNode(child));
      }
      li.appendChild(children);
      item.addEventListener("click", () => li.classList.toggle("closed"));
    } else if (isMarkdown(node.path) || isPdf(node.path)) {
      item.addEventListener("click", () =>
        this.callbacks.onOpenFile(node.path),
      );
    } else {
      item.classList.add("tree-plain-file");
    }

    return li;
  }
}
