/**
 * Toast.ts — Notifications non bloquantes façon Firefox.
 * Les erreurs Rust (chaînes lisibles) remontent ici.
 */

export type ToastKind = "info" | "success" | "error";

const AUTO_DISMISS_MS = 5000;

function root(): HTMLElement {
  const el = document.getElementById("toast-root");
  if (!el) throw new Error("#toast-root introuvable dans index.html");
  return el;
}

export function showToast(message: string, kind: ToastKind = "info"): void {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");

  const badge = document.createElement("span");
  badge.className = "toast-badge";

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;

  const close = document.createElement("button");
  close.className = "toast-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Fermer");

  const dismiss = () => {
    toast.classList.add("closing");
    toast.addEventListener("animationend", () => toast.remove(), {
      once: true,
    });
  };

  close.addEventListener("click", dismiss);
  toast.append(badge, text, close);
  root().appendChild(toast);

  window.setTimeout(dismiss, AUTO_DISMISS_MS);
}

/** Convertit une erreur IPC (souvent une string Rust) en message lisible. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return JSON.stringify(err);
}

/** Affiche l'erreur en toast et la relance en console pour le débogage. */
export function reportError(err: unknown): void {
  console.error(err);
  showToast(errorMessage(err), "error");
}
