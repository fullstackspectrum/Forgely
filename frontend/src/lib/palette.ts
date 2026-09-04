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

/** Channels of a colour string, plus its alpha. */
function parse(color: string): [number, number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [r, g, b, 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n)))
      return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1];
  }
  return null;
}

/**
 * Fade a colour toward the graph background.
 *
 * Dimming by alpha does not survive the node programs: sigma composites with
 * `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, which expects premultiplied colour,
 * and the fill written here is not premultiplied. A node at alpha 0.35 is
 * therefore drawn at close to full strength over a merely darkened background
 * — the reason dimmed nodes stayed bright while edges faded as intended.
 *
 * Mixing toward the canvas colour gives the same appearance a real opacity
 * would, and does it in the one channel every program honours. `keep` is the
 * share of the original colour left: 0 is invisible, 1 is untouched.
 *
 * Measured against both canvases at keep 0.18, a package fill drops from
 * 5.24:1 to 1.25:1 on dark and 3.34:1 to 1.22:1 on light — still legible as
 * shape and position, no longer competing for attention.
 */
/**
 * How much colour survives each kind of dimming, as a share of the original.
 *
 * Collected here because they only make sense relative to one another: the
 * ordering is the meaning. A glance recedes less than a decision, and the node
 * you opened stays ahead of both.
 */
export const DIM = {
  /** Nothing selected, pointer over a node. */
  hover: 0.12,
  /** A package group is open; this is not part of it. */
  group: 0.08,
  /** A node is selected; this is not it or a neighbour. */
  selection: 0.07,
  /** Edges recede further than nodes: they are thin, and there are more of
      them, so at equal strength they read as the louder layer. */
  edge: 0.05,
  /** The group node that was clicked open. */
  openHub: 0.5,
  /** Attached to a search hit. Well above the recede levels above: these are
      the answer to "what is this connected to", so they have to be readable —
      they are simply subordinate to the match itself. */
  searchConnected: 0.55,
} as const;

export function dimToCanvas(color: string, keep: number): string {
  const c = parse(color);
  const bg = parse(token("--g-canvas", "#0A1622"));
  if (!c || !bg) return color;
  const mix = (i: number) => Math.round(c[i] * keep + bg[i] * (1 - keep));
  return `rgba(${mix(0)}, ${mix(1)}, ${mix(2)}, ${c[3]})`;
}
