/**
 * markdown-commands.ts — Commandes d'édition Markdown et raccourcis clavier.
 *
 * Raccourcis façon éditeur moderne :
 *   Ctrl+B        gras (**texte**)
 *   Ctrl+I        italique (*texte*)
 *   Ctrl+K        lien [texte](url)
 *   Ctrl+Shift+K  bloc de code
 *   Tab           sur un en-tête de tableau : génère la ligne |---|---|
 */
import type { KeyBinding } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

/** Encadre (ou désencadre) la sélection avec un marqueur symétrique. */
function toggleWrap(view: EditorView, marker: string): boolean {
  const changes = view.state.changeByRange((range) => {
    const { from, to } = range;
    const before = view.state.sliceDoc(
      Math.max(0, from - marker.length),
      from,
    );
    const after = view.state.sliceDoc(to, to + marker.length);

    // Déjà encadré → on retire le marqueur.
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: from - marker.length, to: from, insert: "" },
          { from: to, to: to + marker.length, insert: "" },
        ],
        range: EditorSelection.range(
          from - marker.length,
          to - marker.length,
        ),
      };
    }

    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: EditorSelection.range(from + marker.length, to + marker.length),
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
  return true;
}

export function toggleBold(view: EditorView): boolean {
  return toggleWrap(view, "**");
}

export function toggleItalic(view: EditorView): boolean {
  return toggleWrap(view, "*");
}

/** Insère un lien [texte](url) autour de la sélection. */
export function insertLink(view: EditorView): boolean {
  const changes = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    if (selected.length > 0) {
      const insert = `[${selected}](url)`;
      return {
        changes: { from: range.from, to: range.to, insert },
        // Sélectionne « url » pour le remplacer immédiatement.
        range: EditorSelection.range(
          range.from + selected.length + 3,
          range.from + selected.length + 6,
        ),
      };
    }
    return {
      changes: { from: range.from, insert: "[texte](url)" },
      range: EditorSelection.range(range.from + 1, range.from + 6),
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
  return true;
}

/** Encadre la sélection dans un bloc de code clôturé. */
export function insertCodeBlock(view: EditorView): boolean {
  const changes = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const insert = "```\n" + selected + "\n```";
    const langPos = range.from + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(langPos),
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
  return true;
}

/** Insère une citation Markdown à la position du curseur. */
export function insertQuote(view: EditorView, text: string): void {
  const quoted =
    text
      .trim()
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n") + "\n\n";
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: quoted },
    selection: EditorSelection.cursor(pos + quoted.length),
    scrollIntoView: true,
    userEvent: "input",
  });
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

/**
 * Autocomplétion de tableau : Tab sur une ligne d'en-tête `| a | b |`
 * génère automatiquement la ligne séparatrice `|---|---|` et une ligne vide.
 */
export function completeTableOnTab(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (!TABLE_ROW.test(line.text) || TABLE_SEPARATOR.test(line.text)) {
    return false;
  }

  // Ne rien faire si la ligne suivante est déjà un séparateur.
  if (line.number < state.doc.lines) {
    const next = state.doc.line(line.number + 1);
    if (TABLE_SEPARATOR.test(next.text)) return false;
  }

  const columns = line.text.split("|").slice(1, -1);
  if (columns.length === 0) return false;

  const separator = "|" + columns.map(() => " --- |").join("");
  const emptyRow = "|" + columns.map(() => "     |").join("");
  const insert = `\n${separator}\n${emptyRow}`;

  view.dispatch({
    changes: { from: line.to, insert },
    // Curseur dans la première cellule de la ligne vide.
    selection: EditorSelection.cursor(line.to + separator.length + 3),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** Raccourcis clavier Markdown de Foxmark. */
export const markdownKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-k", run: insertLink, preventDefault: true },
  { key: "Mod-Shift-k", run: insertCodeBlock, preventDefault: true },
  { key: "Tab", run: completeTableOnTab },
];
