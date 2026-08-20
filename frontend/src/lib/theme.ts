import { refreshPalette } from "./palette";

/**
 * Theme selection.
 *
 * The token file defines light on bare `:root` and dark under
 * `[data-theme="dark"]`, so the attribute on <html> is what selects a theme —
 * removing it silently flips the app to light.
 *
 * "system" stores no preference and follows prefers-color-scheme, which is why
 * it is a distinct value rather than being inferred: a user who picks light on
 * a dark-set machine must keep light.
 */
export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "forgely_theme";

/** What the OS asks for. */
export function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function storedTheme(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "dark";
}

/** The theme actually rendered, resolving "system". */
export function resolveTheme(t: Theme): "light" | "dark" {
  return t === "system" ? systemTheme() : t;
}

/**
 * Apply a theme to the document.
 *
 * Clears the palette cache: lib/palette.ts memoises resolved token values for
 * the canvas, which would otherwise keep serving the previous theme's colours
 * for the life of the page.
 */
export function applyTheme(t: Theme): void {
  const resolved = resolveTheme(t);
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem(STORAGE_KEY, t);
  refreshPalette();
}

/**
 * Watch for OS changes while set to "system".
 *
 * Returns an unsubscribe function.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * The theme currently rendered, read from the document.
 *
 * For code that needs the value at the moment of an action rather than as
 * React state — the report downloads, which must match what the user is
 * looking at when they click. Reading the attribute cannot go stale the way a
 * captured prop can.
 */
export function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
