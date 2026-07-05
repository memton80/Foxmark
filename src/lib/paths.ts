/**
 * paths.ts — Petits utilitaires de chemins côté frontend (affichage).
 * La logique fichier réelle vit côté Rust.
 */

export function basename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? path;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

export function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isMarkdown(path: string): boolean {
  return ["md", "markdown", "mdown"].includes(extension(path));
}

export function isPdf(path: string): boolean {
  return extension(path) === "pdf";
}

/**
 * Chemin relatif de `fromDir` vers `toPath` (avec `../` si nécessaire).
 * Utilisé pour générer des liens Markdown portables entre fichiers.
 */
export function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir.replace(/\/+$/, "").split("/").filter(Boolean);
  const to = toPath.split("/").filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common++;
  }
  const up = from.slice(common).map(() => "..");
  const down = to.slice(common);
  return [...up, ...down].join("/") || ".";
}

export function isImage(path: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(
    extension(path),
  );
}
