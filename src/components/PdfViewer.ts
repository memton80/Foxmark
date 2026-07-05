/**
 * PdfViewer.ts — Visionneuse PDF en lecture seule (rendu natif pdfium).
 * Navigation par page, zoom, recherche de texte, extraction de citation.
 */
import { ipc, type PdfSearchHit } from "../lib/ipc";
import { icon } from "./icons";
import { reportError, showToast } from "./Toast";

export interface PdfViewerCallbacks {
  /** Insère une citation Markdown dans l'éditeur actif. */
  onQuote(text: string): void;
}

export class PdfViewer {
  readonly element: HTMLElement;
  private path: string;
  private callbacks: PdfViewerCallbacks;

  private pageCount = 0;
  private pageIndex = 0;
  private zoom = 1.25;

  private pageImage!: HTMLImageElement;
  private pageIndicator!: HTMLElement;
  private sidePanel!: HTMLElement;
  private sidePanelTitle!: HTMLElement;
  private textContent!: HTMLElement;
  private searchResults!: HTMLElement;
  private renderToken = 0;

  constructor(path: string, callbacks: PdfViewerCallbacks) {
    this.path = path;
    this.callbacks = callbacks;
    this.element = document.createElement("div");
    this.element.className = "pdf-pane";
    this.buildDom();
    void this.load();
  }

  private buildDom(): void {
    const toolbar = document.createElement("div");
    toolbar.className = "pdf-toolbar";

    const prev = this.iconButton("arrowLeft", "Page précédente", () =>
      this.goToPage(this.pageIndex - 1),
    );
    const next = this.iconButton("arrowRight", "Page suivante", () =>
      this.goToPage(this.pageIndex + 1),
    );

    this.pageIndicator = document.createElement("span");
    this.pageIndicator.className = "page-indicator";
    this.pageIndicator.textContent = "– / –";

    const zoomOut = this.iconButton("zoomOut", "Zoom arrière", () =>
      this.setZoom(this.zoom / 1.2),
    );
    const zoomIn = this.iconButton("zoomIn", "Zoom avant", () =>
      this.setZoom(this.zoom * 1.2),
    );

    const search = document.createElement("input");
    search.className = "input pdf-search";
    search.placeholder = "Rechercher dans le PDF…";
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && search.value.trim().length > 0) {
        void this.runSearch(search.value.trim());
      }
    });

    const spacer = document.createElement("span");
    spacer.className = "toolbar-spacer";

    const textToggle = this.iconButton(
      "text",
      "Afficher le texte de la page (pour citer)",
      () => this.toggleTextPanel(),
    );

    toolbar.append(
      prev,
      this.pageIndicator,
      next,
      zoomOut,
      zoomIn,
      spacer,
      search,
      textToggle,
    );

    const body = document.createElement("div");
    body.className = "pdf-body";

    const scroll = document.createElement("div");
    scroll.className = "pdf-scroll";
    this.pageImage = document.createElement("img");
    this.pageImage.className = "pdf-page-image";
    this.pageImage.alt = "Page du document PDF";
    scroll.appendChild(this.pageImage);

    this.sidePanel = document.createElement("div");
    this.sidePanel.className = "pdf-side-panel hidden";

    this.sidePanelTitle = document.createElement("div");
    this.sidePanelTitle.className = "panel-title";

    this.textContent = document.createElement("div");
    this.textContent.className = "pdf-text-content";

    this.searchResults = document.createElement("ul");
    this.searchResults.className = "pdf-search-results";

    const quoteHint = document.createElement("div");
    quoteHint.className = "pdf-quote-hint";
    const quoteButton = document.createElement("button");
    quoteButton.className = "btn";
    quoteButton.appendChild(icon("quote"));
    const quoteLabel = document.createElement("span");
    quoteLabel.textContent = "Citer la sélection";
    quoteButton.appendChild(quoteLabel);
    quoteButton.addEventListener("click", () => this.quoteSelection());
    quoteHint.appendChild(quoteButton);

    this.sidePanel.append(
      this.sidePanelTitle,
      this.textContent,
      this.searchResults,
      quoteHint,
    );

    body.append(scroll, this.sidePanel);
    this.element.append(toolbar, body);
  }

  private iconButton(
    name: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "btn btn-icon";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(icon(name));
    button.addEventListener("click", onClick);
    return button;
  }

  private async load(): Promise<void> {
    try {
      const info = await ipc.pdfInfo(this.path);
      this.pageCount = info.pageCount;
      await this.renderPage();
    } catch (err) {
      this.showError(err);
    }
  }

  private showError(err: unknown): void {
    console.error(err);
    const message = document.createElement("div");
    message.className = "pdf-error";
    const text = document.createElement("p");
    text.textContent =
      typeof err === "string" ? err : "Impossible d'ouvrir ce PDF.";
    message.appendChild(text);
    this.element.replaceChildren(message);
  }

  private async renderPage(): Promise<void> {
    const token = ++this.renderToken;
    try {
      const page = await ipc.pdfRenderPage(this.path, this.pageIndex, this.zoom);
      if (token !== this.renderToken) return;
      this.pageImage.src = `data:image/png;base64,${page.data}`;
      this.pageIndicator.textContent = `${this.pageIndex + 1} / ${this.pageCount}`;
      if (this.isTextPanelOpen()) {
        await this.loadPageText();
      }
    } catch (err) {
      reportError(err);
    }
  }

  private goToPage(index: number): void {
    if (index < 0 || index >= this.pageCount) return;
    this.pageIndex = index;
    void this.renderPage();
  }

  private setZoom(zoom: number): void {
    this.zoom = Math.min(4, Math.max(0.4, zoom));
    void this.renderPage();
  }

  private isTextPanelOpen(): boolean {
    return (
      !this.sidePanel.classList.contains("hidden") &&
      !this.textContent.classList.contains("hidden")
    );
  }

  private toggleTextPanel(): void {
    const wasHidden = this.sidePanel.classList.contains("hidden");
    this.sidePanel.classList.toggle("hidden");
    this.searchResults.classList.add("hidden");
    this.textContent.classList.remove("hidden");
    if (wasHidden) {
      void this.loadPageText();
    }
  }

  private async loadPageText(): Promise<void> {
    this.sidePanelTitle.textContent = `Texte — page ${this.pageIndex + 1}`;
    try {
      const text = await ipc.pdfPageText(this.path, this.pageIndex);
      this.textContent.textContent =
        text.trim().length > 0 ? text : "(Aucun texte détecté sur cette page.)";
    } catch (err) {
      reportError(err);
    }
  }

  private async runSearch(query: string): Promise<void> {
    this.sidePanel.classList.remove("hidden");
    this.textContent.classList.add("hidden");
    this.searchResults.classList.remove("hidden");
    this.sidePanelTitle.textContent = `Résultats pour « ${query} »`;
    this.searchResults.replaceChildren();
    try {
      const hits = await ipc.pdfSearch(this.path, query);
      if (hits.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "Aucune occurrence trouvée.";
        this.searchResults.appendChild(empty);
        return;
      }
      for (const hit of hits) {
        this.searchResults.appendChild(this.renderHit(hit, query));
      }
    } catch (err) {
      reportError(err);
    }
  }

  private renderHit(hit: PdfSearchHit, query: string): HTMLElement {
    const li = document.createElement("li");
    const page = document.createElement("span");
    page.className = "result-page";
    page.textContent = `p. ${hit.pageIndex + 1}`;
    const snippet = document.createElement("span");
    snippet.className = "result-snippet";

    // Met en évidence l'occurrence dans l'extrait (nœuds DOM, pas de HTML brut).
    const lower = hit.snippet.toLowerCase();
    const queryLower = query.toLowerCase();
    const at = lower.indexOf(queryLower);
    if (at >= 0) {
      snippet.append(hit.snippet.slice(0, at));
      const mark = document.createElement("mark");
      mark.textContent = hit.snippet.slice(at, at + query.length);
      snippet.appendChild(mark);
      snippet.append(hit.snippet.slice(at + query.length));
    } else {
      snippet.textContent = hit.snippet;
    }

    li.append(page, snippet);
    li.addEventListener("click", () => this.goToPage(hit.pageIndex));
    return li;
  }

  private quoteSelection(): void {
    const selection = window.getSelection()?.toString() ?? "";
    if (selection.trim().length === 0) {
      showToast(
        "Sélectionnez du texte dans le panneau « Texte de la page ».",
        "info",
      );
      return;
    }
    this.callbacks.onQuote(selection);
  }
}
