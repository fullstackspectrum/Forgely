import { NodeImageProgram } from "@sigma/node-image";
import { createNodeBorderProgram } from "@sigma/node-border";
import { NodeCircleProgram, createNodeCompoundProgram } from "sigma/rendering";

import { token } from "../lib/palette";

/**
 * Node fill plus a severity ring.
 *
 * BRANDING.md §6: "never colour a node by severity and by hop distance at the
 * same time. Pick one for fill and give the other a ring... The default should
 * be fill = hop distance, ring = severity, since the graph's job is showing
 * reach."
 *
 * The ring is one width for every level. It used to widen with severity —
 * 6/4/2.5/1.5px — to satisfy the spec's greyscale criterion ("desaturate it,
 * check you can still find the origin and read severity"), since the ramp
 * collapses when desaturated: Critical reads as grey 150 and Low as 153 out of
 * 255, and the greyscale ordering is not even severity ordering
 * (None < Critical < Low < High < Medium).
 *
 * At 6px a Critical ring was heavy enough to read as a different kind of node
 * rather than a worse one, so severity is carried by colour here and the width
 * is uniform. The greyscale criterion is met away from the canvas instead:
 * every severity in the panels and the legend is a distinct *shape* — see
 * SeverityMark — which survives desaturation completely.
 */

/* Ring width in pixels. One width for every severity that has a ring; None
 * and Unknown get none at all.
 *
 * 4px was High's width, and it is comfortably clear of the floor: the
 * generated shader drops any ring specified at <= 1px, at every zoom level. */
const RING_WIDTH = 4;

export const SEVERITY_RING: Record<string, number> = {
  Critical: RING_WIDTH,
  High: RING_WIDTH,
  Medium: RING_WIDTH,
  Low: RING_WIDTH,
  None: 0,
  Unknown: 0,
};

export function severityRing(severity: string | null | undefined): {
  borderColor: string;
  borderSize: number;
} {
  const sev = severity && severity in SEVERITY_RING ? severity : "Unknown";
  const size = SEVERITY_RING[sev];
  if (!size) {
    // A transparent ring of zero width still has to be a valid colour: the
    // shader reads the attribute regardless of size.
    return { borderColor: token("--g-node-stroke"), borderSize: 0 };
  }
  return {
    /* --g-sev-* rather than --s-*: the canvas ramp is saturated for a ring on
       the canvas, where the text-contrast rules do not apply. */
    borderColor: token(
      sev === "Critical" ? "--g-sev-critical"
        : sev === "High" ? "--g-sev-high"
          : sev === "Medium" ? "--g-sev-medium"
            : "--g-sev-low",
    ),
    borderSize: size,
  };
}

/* Ring only — no fill layer, so the node body stays transparent and whatever
 * is drawn beneath shows through.
 *
 * The obvious arrangement, [border, image], does not work: NodeImageProgram
 * defaults to padding 0 and keepWithinCircle true, so it paints a disc across
 * the whole node and hides a border drawn inside the radius. Insetting the
 * image with padding is the other way out, but padding is a program-level
 * uniform (u_percentagePadding) while these rings are pixel-width and node
 * sizes span 16–40px, so no single value fits.
 *
 * Drawing the ring last sidesteps both problems.
 */
const RingProgram = createNodeBorderProgram({
  borders: [
    {
      color: { attribute: "borderColor", defaultValue: "transparent" },
      size: { attribute: "borderSize", defaultValue: 0, mode: "pixels" },
    },
    /* A transparent fill rather than no fill at all: the generated shader
       divides by the number of fill layers, so omitting it entirely would
       divide by zero. This keeps the interior see-through and the arithmetic
       valid. */
    { color: { transparent: true }, size: { fill: true } },
  ],
});

/** Format icon first, severity ring painted over its outer edge. */
export const NodeImageWithRingProgram = createNodeCompoundProgram([
  NodeImageProgram,
  RingProgram,
]);

/* Packages whose format has no icon get no `type` and fall through to sigma's
   default program, which knows nothing about rings. Registering this as
   defaultNodeType means severity is encoded on those nodes too. */
export const NodeCircleWithRingProgram = createNodeCompoundProgram([
  NodeCircleProgram,
  RingProgram,
]);

export { RingProgram as NodeRingOnlyProgram };

/** Resting fill for a node, by what it is. Hop distance overrides this in the
 *  reducer once an origin is selected. */
export function nodeFill(nodeType: string | undefined): string {
  return nodeType === "repo"
    /* The repository is the mark's ember centre cell — the one disturbed
       square everything else sits around. §1 allows exactly one ember per
       view, and this is it; selection is marked by the tilt instead. */
    ? token("--c-origin")
    : nodeType === "dependency"
      ? token("--fg-blue-200")   /* transitive reads as Mist */
      : token("--fg-blue-400");  /* Signal blue for packages */
}

/**
 * Re-resolve every node's colours after a theme change.
 *
 * Node colours are baked into graph attributes when the graph is built, and
 * token() memoises what it read, so a theme switch leaves both holding the old
 * palette. Rebuilding the whole sigma instance would also work but costs a
 * teardown and a fresh layout on graphs of several thousand nodes.
 *
 * Call refreshPalette() before this, or it re-reads the stale cache.
 */
export function recolorGraph(graph: {
  forEachNode: (cb: (id: string, attrs: Record<string, unknown>) => void) => void;
  setNodeAttribute: (id: string, key: string, value: unknown) => void;
}): void {
  graph.forEachNode((id, attrs) => {
    const type = attrs.nodeType as string | undefined;
    if (type === "echo") return;
    graph.setNodeAttribute(id, "color", nodeFill(type));
    if (type === "package") {
      const ring = severityRing(attrs.severity as string | undefined);
      graph.setNodeAttribute(id, "borderColor", ring.borderColor);
      graph.setNodeAttribute(id, "borderSize", ring.borderSize);
    } else {
      graph.setNodeAttribute(id, "borderColor", token("--g-node-stroke"));
    }
  });
}
