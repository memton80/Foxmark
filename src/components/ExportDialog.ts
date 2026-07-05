/**
 * ExportDialog.ts — Dialogue d'export Markdown → PDF.
 *
 * Deux modes de style : CSS GitHub par défaut, ou CSS personnalisé
 * (en remplacement ou en surcouche). Les réglages choisis ici pilotent
 * AUSSI l'aperçu live, qui reste ainsi identique au PDF final.
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import { ipc, type CssMode, type HeaderFooterOptions } from "../lib/ipc";
import { basename } from "../lib/paths";
import { showToast, reportError } from "./Toast";

export interface ExportSettings {
  cssMode: CssMode;
  customCssPath: string | null;
  headerFooter: HeaderFooterOptions;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  cssMode: "github",
  customCssPath: null,
  headerFooter: {
    enabled: true,
    showTitle: true,
    showDate: true,
    showPageNumbers: true,
  },
};

interface ExportRequest {
  source: string;
  docPath: string | null;
  title: string;
}

export class ExportDialog {
  private overlay: HTMLElement;
  private settings: ExportSettings;
  private request: ExportRequest | null = null;
  private onSettingsChanged: (settings: ExportSettings) => void;

  constructor(
    root: HTMLElement,
    initial: ExportSettings,
    onSettingsChanged: (settings: ExportSettings) => void,
  ) {
    this.settings = structuredClone(initial);
    this.onSettingsChanged = onSettingsChanged;
    this.overlay = document.createElement("div");
    this.overlay.className = "dialog-overlay";
    root.appendChild(this.overlay);
    this.overlay.addEventListener("mousedown", (event) => {
      if (event.target === this.overlay) this.close();
    });
  }

  open(request: ExportRequest): void {
    this.request = request;
    this.render();
    this.overlay.classList.add("open");
  }

  close(): void {
    this.overlay.classList.remove("open");
  }

  private render(): void {
    this.overlay.replaceChildren();
    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Exporter en PDF");

    const title = document.createElement("h2");
    title.textContent = "Exporter en PDF";
    dialog.appendChild(title);

    dialog.appendChild(this.renderCssGroup());
    dialog.appendChild(this.renderHeaderFooterGroup());

    const note = document.createElement("p");
    note.className = "dialog-note";
    note.textContent =
      "L'aperçu live utilise exactement ce style : ce que vous voyez est ce qui sera exporté.";
    dialog.appendChild(note);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = "Annuler";
    cancel.addEventListener("click", () => this.close());
    const confirm = document.createElement("button");
    confirm.className = "btn btn-primary";
    confirm.textContent = "Exporter…";
    confirm.addEventListener("click", () => void this.runExport(confirm));
    actions.append(cancel, confirm);
    dialog.appendChild(actions);

    this.overlay.appendChild(dialog);
  }

  private renderCssGroup(): HTMLElement {
    const group = document.createElement("div");
    group.className = "field-group";
    const label = document.createElement("span");
    label.className = "group-label";
    label.textContent = "Style du document";
    group.appendChild(label);

    const modes: Array<{ value: CssMode; text: string }> = [
      { value: "github", text: "CSS GitHub (par défaut)" },
      { value: "custom", text: "CSS personnalisé (remplacement)" },
      { value: "overlay", text: "CSS personnalisé (surcouche du thème GitHub)" },
    ];

    const pickerRow = document.createElement("div");

    for (const mode of modes) {
      const choice = document.createElement("label");
      choice.className = "choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "css-mode";
      radio.value = mode.value;
      radio.checked = this.settings.cssMode === mode.value;
      radio.addEventListener("change", () => {
        this.settings.cssMode = mode.value;
        this.applySettings();
        pickerRow.classList.toggle(
          "row-disabled",
          this.settings.cssMode === "github",
        );
      });
      const text = document.createElement("span");
      text.textContent = mode.text;
      choice.append(radio, text);
      group.appendChild(choice);
    }

    pickerRow.className =
      this.settings.cssMode === "github"
        ? "file-picker-row row-disabled"
        : "file-picker-row";
    const picked = document.createElement("span");
    picked.className = "picked-file";
    picked.textContent = this.settings.customCssPath
      ? basename(this.settings.customCssPath)
      : "Aucun fichier .css choisi";
    const browse = document.createElement("button");
    browse.className = "btn";
    browse.textContent = "Choisir…";
    browse.addEventListener("click", () => {
      void (async () => {
        const file = await open({
          multiple: false,
          filters: [{ name: "Feuilles de style", extensions: ["css"] }],
        });
        if (typeof file === "string") {
          this.settings.customCssPath = file;
          picked.textContent = basename(file);
          this.applySettings();
        }
      })();
    });
    pickerRow.append(picked, browse);
    group.appendChild(pickerRow);
    return group;
  }

  private renderHeaderFooterGroup(): HTMLElement {
    const group = document.createElement("div");
    group.className = "field-group";
    const label = document.createElement("span");
    label.className = "group-label";
    label.textContent = "En-tête et pied de page";
    group.appendChild(label);

    const options: Array<{
      key: keyof HeaderFooterOptions;
      text: string;
    }> = [
      { key: "enabled", text: "Afficher en-tête et pied de page" },
      { key: "showTitle", text: "Titre du document (en-tête)" },
      { key: "showDate", text: "Date d'export (en-tête)" },
      { key: "showPageNumbers", text: "Numéros de page (pied de page)" },
    ];

    for (const option of options) {
      const choice = document.createElement("label");
      choice.className = "choice";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.settings.headerFooter[option.key];
      checkbox.addEventListener("change", () => {
        this.settings.headerFooter[option.key] = checkbox.checked;
        this.applySettings();
      });
      const text = document.createElement("span");
      text.textContent = option.text;
      choice.append(checkbox, text);
      group.appendChild(choice);
    }
    return group;
  }

  private applySettings(): void {
    this.onSettingsChanged(structuredClone(this.settings));
  }

  private async runExport(button: HTMLButtonElement): Promise<void> {
    if (!this.request) return;
    if (this.settings.cssMode !== "github" && !this.settings.customCssPath) {
      showToast("Choisissez d'abord un fichier .css personnalisé.", "error");
      return;
    }

    const suggested = this.request.docPath
      ? basename(this.request.docPath).replace(/\.\w+$/, ".pdf")
      : "document.pdf";
    const outputPath = await save({
      defaultPath: suggested,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!outputPath) return;

    button.disabled = true;
    button.textContent = "Export en cours…";
    try {
      const written = await ipc.exportPdf({
        source: this.request.source,
        docPath: this.request.docPath,
        outputPath,
        cssMode: this.settings.cssMode,
        customCssPath: this.settings.customCssPath,
        headerFooter: this.settings.headerFooter,
        title: this.request.title,
      });
      showToast(`PDF exporté : ${written}`, "success");
      this.close();
    } catch (err) {
      reportError(err);
    } finally {
      button.disabled = false;
      button.textContent = "Exporter…";
    }
  }
}
