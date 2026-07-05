/**
 * autocomplete.ts — Sources d'autocomplétion Markdown de Foxmark.
 *
 *   [[    → liens wiki vers les autres fichiers .md du dossier ouvert
 *   ![    → sélecteur d'image (fichiers du dossier assets/ + parcourir)
 *   ```   → liste des langages de bloc de code (avec coloration)
 *   ](#   → ancres des titres du document (sommaire)
 *   #     → suggestions de titres basées sur le sommaire existant
 */
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { languages } from "@codemirror/language-data";
import type { EditorView } from "@codemirror/view";
import type { Text } from "@codemirror/state";

/**
 * Fournisseurs de données externes (injectés par l'application) :
 * liste des fichiers .md du dossier, images disponibles, sélecteur natif.
 */
export interface CompletionProviders {
  /** Chemins relatifs des fichiers .md du dossier de travail. */
  markdownFiles(): string[];
  /** Chemins relatifs des images du dossier assets/ du document. */
  imageFiles(): string[];
  /** Ouvre le sélecteur d'image natif, copie dans assets/, insère le lien. */
  browseImage(view: EditorView, from: number, to: number): void;
}

/** Slug d'ancre, aligné sur l'algorithme Rust (src-tauri/src/markdown.rs). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s]+/g, "-");
}

interface Heading {
  level: number;
  text: string;
}

/** Extrait le sommaire (titres ATX) du document. */
export function documentHeadings(doc: Text): Heading[] {
  const headings: Heading[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i).text;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2] });
    }
  }
  return headings;
}

export function createCompletionSources(providers: CompletionProviders) {
  /** [[ → liens wiki vers les fichiers .md du dossier. */
  function wikiLinks(context: CompletionContext): CompletionResult | null {
    const match = context.matchBefore(/\[\[([^\]\n]*)$/);
    if (!match) return null;

    const options: Completion[] = providers.markdownFiles().map((relPath) => {
      const name = relPath.replace(/\.md$/i, "").split("/").pop() ?? relPath;
      return {
        label: relPath,
        displayLabel: name,
        detail: relPath,
        type: "text",
        apply: (view, _completion, from, to) => {
          // Remplace `[[…` (et un éventuel `]]` déjà fermé) par un lien standard.
          const closing = view.state.sliceDoc(to, to + 2) === "]]" ? 2 : 0;
          view.dispatch({
            changes: {
              from: from - 2,
              to: to + closing,
              insert: `[${name}](${encodeURI(relPath)})`,
            },
          });
        },
      };
    });

    return {
      from: match.from + 2,
      options,
      validFor: /^[^\]\n]*$/,
    };
  }

  /** ![ → sélecteur d'image. */
  function images(context: CompletionContext): CompletionResult | null {
    const match = context.matchBefore(/!\[([^\]\n]*)$/);
    if (!match) return null;

    const browse: Completion = {
      label: "Parcourir une image…",
      type: "function",
      boost: 10,
      apply: (view, _completion, from, to) => {
        providers.browseImage(view, from - 2, to);
      },
    };

    const existing: Completion[] = providers.imageFiles().map((relPath) => ({
      label: relPath,
      type: "constant",
      apply: (view, _completion, from, to) => {
        const alt = relPath.split("/").pop()?.replace(/\.\w+$/, "") ?? "image";
        view.dispatch({
          changes: {
            from: from - 2,
            to,
            insert: `![${alt}](${encodeURI(relPath)})`,
          },
        });
      },
    }));

    return {
      from: match.from + 2,
      options: [browse, ...existing],
      validFor: /^[^\]\n]*$/,
    };
  }

  /** ``` → langages de bloc de code (colorés par language-data). */
  function codeFences(context: CompletionContext): CompletionResult | null {
    const match = context.matchBefore(/^```(\w*)$/);
    if (!match) return null;

    const options: Completion[] = languages.map((lang) => ({
      label: lang.name.toLowerCase(),
      displayLabel: lang.name,
      detail: lang.extensions.slice(0, 3).map((e) => `.${e}`).join(" "),
      type: "type",
      apply: (view, completion, from, to) => {
        const insert = `${completion.label}\n\n\`\`\``;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + completion.label.length + 1 },
        });
      },
    }));

    return {
      from: match.from + 3,
      options,
      validFor: /^\w*$/,
    };
  }

  /** ](# → ancres du sommaire du document. */
  function headingAnchors(context: CompletionContext): CompletionResult | null {
    const match = context.matchBefore(/\]\(#([\w-]*)$/);
    if (!match) return null;

    const options: Completion[] = documentHeadings(context.state.doc).map(
      (h) => ({
        label: slugify(h.text),
        displayLabel: `#${slugify(h.text)}`,
        detail: `${"#".repeat(h.level)} ${h.text}`,
        type: "keyword",
      }),
    );

    return {
      from: match.from + 3,
      options,
      validFor: /^[\w-]*$/,
    };
  }

  /**
   * # en début de ligne → suggestions de titres basées sur le sommaire
   * existant (utile pour garder une nomenclature de sections cohérente).
   */
  function headingSuggestions(
    context: CompletionContext,
  ): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    const match = /^(#{1,6})\s(\S*)$/.exec(before);
    if (!match) return null;
    // Ne pas proposer sans saisie explicite (sinon trop intrusif).
    if (!context.explicit && match[2].length === 0) return null;

    const currentLineNumber = line.number;
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (let i = 1; i <= context.state.doc.lines; i++) {
      if (i === currentLineNumber) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(context.state.doc.line(i).text);
      if (!m || seen.has(m[2])) continue;
      seen.add(m[2]);
      options.push({
        label: m[2],
        detail: `${"#".repeat(m[1].length)} (existant)`,
        type: "text",
      });
    }
    if (options.length === 0) return null;

    return {
      from: line.from + match[1].length + 1,
      options,
      validFor: /^[^\n]*$/,
    };
  }

  return [wikiLinks, images, codeFences, headingAnchors, headingSuggestions];
}
