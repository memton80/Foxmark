/**
 * icons.ts — Icônes SVG inline, style Proton (traits fins, arrondis).
 * Les SVG ne portent aucun style : tout (taille, couleur, épaisseur de
 * trait) est défini par les classes CSS des conteneurs.
 */

const ICONS: Record<string, string> = {
  document:
    '<path d="M4 2.5h5.5L13 6v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"/><path d="M9.5 2.5V6H13"/>',
  pdf: '<path d="M4 2.5h5.5L13 6v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"/><path d="M5.5 11.5h5M5.5 9h5"/>',
  folder:
    '<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z"/>',
  folderOpen:
    '<path d="M2.5 5.5v-1a1 1 0 0 1 1-1h3L8 5h4.5a1 1 0 0 1 1 1v1"/><path d="M2 7h12l-1.5 5.5a1 1 0 0 1-1 .75H4.4a1 1 0 0 1-1-.75L2 7Z"/>',
  close: '<path d="M3 3l10 10M13 3L3 13"/>',
  caret: '<path d="M4 6l4 4 4-4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  sidebar:
    '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/>',
  preview:
    '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10M10 6.5h2M10 9.5h2"/>',
  export:
    '<path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  command:
    '<path d="M5 3a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v10a2 2 0 1 0 2-2H3a2 2 0 1 0 2 2V3Z"/>',
  focus:
    '<path d="M3 6V4a1 1 0 0 1 1-1h2M10 3h2a1 1 0 0 1 1 1v2M13 10v2a1 1 0 0 1-1 1h-2M6 13H4a1 1 0 0 1-1-1v-2"/>',
  save: '<path d="M3 4a1 1 0 0 1 1-1h7l2 2v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Z"/><path d="M5.5 3v3h5V3M5.5 13V9.5h5V13"/>',
  quote:
    '<path d="M4 5h8M4 8h8M4 11h5"/><path d="M2 3.5v9"/>',
  arrowLeft: '<path d="M10 3L5 8l5 5"/>',
  arrowRight: '<path d="M6 3l5 5-5 5"/>',
  zoomIn:
    '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14M5 7h4M7 5v4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14M5 7h4"/>',
  text: '<path d="M3 4h10M8 4v9"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 2"/>',
};

/** Crée un élément SVG pour l'icône demandée. */
export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] ?? ICONS.document;
  return svg;
}
