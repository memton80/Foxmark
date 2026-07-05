/**
 * CommandPalette.ts — Palette de commandes rapide, inspirée de la barre
 * d'adresse Firefox. Ouverte avec Ctrl+L (ou Ctrl+Shift+P).
 */
import { icon } from "./icons";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  iconName?: string;
  action(): void | Promise<void>;
}

/** Filtre par sous-séquence (fuzzy léger, insensible à la casse/accents). */
function fuzzyMatch(query: string, target: string): boolean {
  const normalizedQuery = normalize(query);
  const normalizedTarget = normalize(target);
  let i = 0;
  for (const char of normalizedTarget) {
    if (char === normalizedQuery[i]) i++;
    if (i === normalizedQuery.length) return true;
  }
  return normalizedQuery.length === 0;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

export class CommandPalette {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private results: HTMLElement;
  private commandsProvider: () => PaletteCommand[];
  private filtered: PaletteCommand[] = [];
  private selectedIndex = 0;

  constructor(root: HTMLElement, commandsProvider: () => PaletteCommand[]) {
    this.commandsProvider = commandsProvider;

    this.overlay = document.createElement("div");
    this.overlay.className = "palette-overlay";

    const palette = document.createElement("div");
    palette.className = "palette";
    palette.setAttribute("role", "dialog");
    palette.setAttribute("aria-label", "Palette de commandes");

    this.input = document.createElement("input");
    this.input.className = "palette-input";
    this.input.placeholder = "Rechercher une commande…";
    this.input.setAttribute("spellcheck", "false");

    this.results = document.createElement("ul");
    this.results.className = "palette-results";

    palette.append(this.input, this.results);
    this.overlay.appendChild(palette);
    root.appendChild(this.overlay);

    this.overlay.addEventListener("mousedown", (event) => {
      if (event.target === this.overlay) this.close();
    });

    this.input.addEventListener("input", () => {
      this.selectedIndex = 0;
      this.renderResults();
    });

    this.input.addEventListener("keydown", (event) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          this.close();
          break;
        case "ArrowDown":
          event.preventDefault();
          this.moveSelection(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          this.moveSelection(-1);
          break;
        case "Enter":
          event.preventDefault();
          this.runSelected();
          break;
      }
    });
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains("open");
  }

  open(): void {
    this.input.value = "";
    this.selectedIndex = 0;
    this.overlay.classList.add("open");
    this.renderResults();
    this.input.focus();
  }

  close(): void {
    this.overlay.classList.remove("open");
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private moveSelection(delta: number): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.filtered.length) %
      this.filtered.length;
    this.renderResults();
  }

  private runSelected(): void {
    const command = this.filtered[this.selectedIndex];
    if (!command) return;
    this.close();
    void command.action();
  }

  private renderResults(): void {
    const query = this.input.value;
    this.filtered = this.commandsProvider().filter((cmd) =>
      fuzzyMatch(query, cmd.label),
    );
    this.results.replaceChildren();

    if (this.filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "palette-empty";
      empty.textContent = "Aucune commande ne correspond.";
      this.results.appendChild(empty);
      return;
    }

    this.filtered.forEach((command, index) => {
      const li = document.createElement("li");
      li.className =
        index === this.selectedIndex ? "palette-item selected" : "palette-item";
      li.appendChild(icon(command.iconName ?? "command"));

      const label = document.createElement("span");
      label.className = "item-label";
      label.textContent = command.label;
      li.appendChild(label);

      if (command.hint) {
        const hint = document.createElement("kbd");
        hint.className = "shortcut";
        hint.textContent = command.hint;
        li.appendChild(hint);
      }

      li.addEventListener("mousemove", () => {
        if (this.selectedIndex !== index) {
          this.selectedIndex = index;
          this.renderResults();
        }
      });
      li.addEventListener("click", () => {
        this.selectedIndex = index;
        this.runSelected();
      });
      this.results.appendChild(li);
    });

    const selected = this.results.children[this.selectedIndex];
    selected?.scrollIntoView({ block: "nearest" });
  }
}
