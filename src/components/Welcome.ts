/**
 * Welcome.ts — Onglet d'accueil : actions rapides + fichiers récents.
 */
import { ipc } from "../lib/ipc";
import { dirname } from "../lib/paths";
import { reportError } from "./Toast";

export interface WelcomeCallbacks {
  onNewFile(): void;
  onOpenFile(): void;
  onOpenFolder(): void;
  onOpenRecent(path: string): void;
}

export function createWelcomePane(callbacks: WelcomeCallbacks): HTMLElement {
  const pane = document.createElement("div");
  pane.className = "welcome-pane";

  const logo = document.createElement("div");
  logo.className = "welcome-logo";
  const mark = document.createElement("div");
  mark.className = "logo-mark";
  mark.textContent = "F";
  const title = document.createElement("h1");
  title.textContent = "Foxmark";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Éditeur Markdown natif, inspiré de Firefox.";
  logo.append(mark, title, subtitle);

  const actions = document.createElement("div");
  actions.className = "welcome-actions";
  const newBtn = document.createElement("button");
  newBtn.className = "btn btn-primary";
  newBtn.textContent = "Nouveau document";
  newBtn.addEventListener("click", () => callbacks.onNewFile());
  const openBtn = document.createElement("button");
  openBtn.className = "btn";
  openBtn.textContent = "Ouvrir un fichier…";
  openBtn.addEventListener("click", () => callbacks.onOpenFile());
  const folderBtn = document.createElement("button");
  folderBtn.className = "btn";
  folderBtn.textContent = "Ouvrir un dossier…";
  folderBtn.addEventListener("click", () => callbacks.onOpenFolder());
  actions.append(newBtn, openBtn, folderBtn);

  const recents = document.createElement("div");
  recents.className = "welcome-recents";

  pane.append(logo, actions, recents);

  void (async () => {
    try {
      const files = await ipc.getRecentFiles();
      if (files.length === 0) return;
      const heading = document.createElement("h2");
      heading.textContent = "Fichiers récents";
      const list = document.createElement("ul");
      for (const file of files.slice(0, 8)) {
        const li = document.createElement("li");
        const item = document.createElement("div");
        item.className = "recent-item";
        const name = document.createElement("span");
        name.className = "recent-name";
        name.textContent = file.name;
        const path = document.createElement("span");
        path.className = "recent-path";
        path.textContent = dirname(file.path);
        item.append(name, path);
        item.addEventListener("click", () => callbacks.onOpenRecent(file.path));
        li.appendChild(item);
        list.appendChild(li);
      }
      recents.append(heading, list);
    } catch (err) {
      reportError(err);
    }
  })();

  return pane;
}
