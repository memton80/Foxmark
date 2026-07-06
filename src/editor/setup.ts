/**
 * setup.ts — Construction d'une instance CodeMirror 6 pour un document.
 *
 * NOTE sur la règle « pas de CSS dans le HTML / injecté en JS » :
 * nous n'utilisons ni EditorView.theme() ni HighlightStyle.define()
 * (qui génèrent des styles dynamiques). La coloration passe par
 * `classHighlighter`, qui pose des classes statiques `tok-*` stylées
 * dans src/styles/editor.css.
 */
import { EditorView, keymap, drawSelection, dropCursor } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  syntaxHighlighting,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { classHighlighter, tagHighlighter, tags } from "@lezer/highlight";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { highlightActiveLine } from "@codemirror/view";
import { markdownKeymap } from "./markdown-commands";
import {
  createCompletionSources,
  type CompletionProviders,
} from "./autocomplete";

export interface EditorCallbacks {
  onChange(content: string): void;
  onSaveRequested(): void;
}

/**
 * Fermeture automatique des paires Markdown : en plus des crochets
 * habituels, `*` , `_` et `` ` `` se ferment automatiquement.
 */
const markdownCloseBrackets = markdownLanguage.data.of({
  closeBrackets: {
    brackets: ["(", "[", "{", "'", '"', "`", "*", "_"],
  },
});

/**
 * Classes par niveau de titre (tok-heading1 … tok-heading6) pour le rendu
 * « en direct » dans la page d'écriture : tailles définies dans editor.css.
 * Toujours des classes statiques — aucun style injecté.
 */
const headingLevelHighlighter = tagHighlighter([
  { tag: tags.heading1, class: "tok-heading1" },
  { tag: tags.heading2, class: "tok-heading2" },
  { tag: tags.heading3, class: "tok-heading3" },
  { tag: tags.heading4, class: "tok-heading4" },
  { tag: tags.heading5, class: "tok-heading5" },
  { tag: tags.heading6, class: "tok-heading6" },
]);

export function createEditor(
  parent: HTMLElement,
  initialContent: string,
  callbacks: EditorCallbacks,
  providers: CompletionProviders,
): EditorView {
  const completionSources = createCompletionSources(providers);

  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      // Pas de numéros de ligne : la zone d'écriture est une « page »
      // unique où le Markdown se met en forme pendant la frappe.
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: true,
      }),
      markdownCloseBrackets,
      closeBrackets(),
      autocompletion({
        override: completionSources,
        activateOnTyping: true,
        icons: true,
      }),
      syntaxHighlighting(classHighlighter),
      syntaxHighlighting(headingLevelHighlighter),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            callbacks.onSaveRequested();
            return true;
          },
        },
        ...markdownKeymap,
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...foldKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          callbacks.onChange(update.state.doc.toString());
        }
      }),
    ],
  });

  return new EditorView({ state, parent });
}
