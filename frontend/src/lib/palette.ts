/**
 * Design tokens for code that cannot use `var(--token)`.
 *
 * DOM inline styles resolve `var()` themselves, so components should just
 * write `var(--s-critical)` and never call this. Sigma renders through WebGL
 * and the hover overlay through canvas 2D — both need a resolved colour
 * string, and that is the only reason this exists.
 *
 * Values are read from the stylesheet rather than duplicated here, so there is
 * no second copy of the palette to drift out of sync with tokens.css.
 */

let cache: Record<string, string> = {};

/** Resolve a CSS custom property to its computed value. */
export function token(name: string, fallback = "#000000"): string {
  if (name in cache) return cache[name];
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  // An empty string means the property is not defined — a typo'd token would
  // otherwise silently render transparent black.
  if (!value && import.meta.env.DEV) {
    console.warn(`[palette] unknown token ${name}`);
  }
  cache[name] = value || fallback;
  return cache[name];
}

/**
 * Drop the cache after a theme change.
 *
 * Nothing calls this yet — dark is the only theme rendered — but the graph
 * caches resolved colours on its nodes, so a theme toggle has to clear this
 * and rebuild, not just flip the attribute.
 */
export function refreshPalette(): void {
  cache = {};
}

/** Node fill by hop distance from the origin (BRANDING.md §2.5). */
export const hopColor = (hops: number): string =>
  token(hops <= 0 ? "--g-hop-0" : hops === 1 ? "--g-hop-1"
      : hops === 2 ? "--g-hop-2" : hops === 3 ? "--g-hop-3" : "--g-hop-far");
