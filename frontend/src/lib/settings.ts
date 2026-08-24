import type { EdgeStyle, LayoutType } from "../types";

/**
 * Preferences that outlive a session.
 *
 * The line drawn here is between a *preference* and a *query*. Hiding
 * dependency edges says how this user wants graphs drawn and should still be
 * true tomorrow; filtering to Critical packages is a question about the repo
 * currently open, and restoring it on a fresh load would show a graph with
 * most of its nodes missing and no obvious reason why. So the visibility
 * toggles and the drawing options persist, and the severity and status filters
 * deliberately do not.
 *
 * Theme is stored separately by lib/theme.ts: the boot script in index.html
 * has to read it before any module runs, or the first paint flashes the wrong
 * palette.
 */

export interface Settings {
  hideSharedCveEdges: boolean;
  hideDependencies: boolean;
  hideUnsupported: boolean;
  hideCriticalAnimation: boolean;
  edgeStyle: EdgeStyle;
  layout: LayoutType;
}

export const DEFAULT_SETTINGS: Settings = {
  hideSharedCveEdges: false,
  hideDependencies: false,
  hideUnsupported: false,
  hideCriticalAnimation: false,
  edgeStyle: "curved",
  layout: "force",
};

/* Versioned: a rename or a type change in the shape above must not be handed a
   stale blob written by an older build. */
const STORAGE_KEY = "forgely_settings_v1";

const EDGE_STYLES: EdgeStyle[] = ["curved", "straight"];
const LAYOUTS: LayoutType[] = ["force", "circular", "radial", "tree", "horizontal"];

/**
 * Stored settings, merged over the defaults.
 *
 * Every field is checked rather than trusted. localStorage is shared with
 * anything else on the origin and survives every deploy, so a value of the
 * wrong type here would otherwise reach the reducers as-is — a string where a
 * boolean is expected is truthy, which would silently hide half the graph.
 */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };

    const bool = (k: keyof Settings) =>
      typeof parsed[k] === "boolean" ? (parsed[k] as boolean) : (DEFAULT_SETTINGS[k] as boolean);

    return {
      hideSharedCveEdges: bool("hideSharedCveEdges"),
      hideDependencies: bool("hideDependencies"),
      hideUnsupported: bool("hideUnsupported"),
      hideCriticalAnimation: bool("hideCriticalAnimation"),
      edgeStyle: EDGE_STYLES.includes(parsed.edgeStyle as EdgeStyle)
        ? (parsed.edgeStyle as EdgeStyle) : DEFAULT_SETTINGS.edgeStyle,
      layout: LAYOUTS.includes(parsed.layout as LayoutType)
        ? (parsed.layout as LayoutType) : DEFAULT_SETTINGS.layout,
    };
  } catch {
    /* Private browsing can make localStorage throw on read, and a hand-edited
       value can fail to parse. Neither is a reason to fail to start. */
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist one field. Failing to save is not worth breaking the UI over. */
export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  try {
    const next = { ...loadSettings(), [key]: value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Quota exceeded, or storage disabled. The setting still applies to this
       session; it just will not survive a reload. */
  }
}

/** Back to defaults, on disk and in memory. */
export function resetSettings(): Settings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* nothing to clear */ }
  return { ...DEFAULT_SETTINGS };
}
