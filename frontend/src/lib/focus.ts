import type Sigma from "sigma";

/**
 * Move the camera to hold a set of nodes.
 *
 * Sigma's camera and `getNodeDisplayData` share the same framed coordinate
 * space, where a ratio of 1 shows the whole graph — so fitting a subset is a
 * matter of measuring its box in that space and using the larger side as the
 * ratio.
 */

/** Leave a margin around the box, so nodes do not sit against the edge. */
const PADDING = 1.3;

/**
 * Closest the camera will go, as a share of the whole graph.
 *
 * Without a floor, focusing two adjacent versions in a 7,000-node graph asks
 * for a ratio near zero and the view flies into empty space between two nodes.
 */
const MIN_RATIO = 0.1;

/* Furthest the camera will pull back. A node stranded far from the rest — one
 * that a layout left behind — would otherwise zoom the graph down to a speck
 * in order to include it. */
const MAX_FIT_RATIO = 4;

export interface FocusOptions {
  duration?: number;
  /** Never zoom past this. Defaults to MIN_RATIO. */
  minRatio?: number;
}

/**
 * Frame `ids`, animating from wherever the camera is.
 *
 * Nodes that are not on screen — filtered out, or belonging to a group that is
 * closed — are skipped rather than counted at the origin, which would drag the
 * box across the whole graph.
 */
export function focusNodes(sigma: Sigma, ids: string[], opts: FocusOptions = {}): void {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  let found = 0;

  for (const id of ids) {
    const d = sigma.getNodeDisplayData(id);
    if (!d || d.hidden) continue;
    found++;
    if (d.x < minx) minx = d.x;
    if (d.x > maxx) maxx = d.x;
    if (d.y < miny) miny = d.y;
    if (d.y > maxy) maxy = d.y;
  }
  if (found === 0) return;

  const camera = sigma.getCamera();
  const x = (minx + maxx) / 2;
  const y = (miny + maxy) / 2;

  /* A single node has no extent, so there is nothing to fit — hold the zoom
     the user already chose and only recentre. Overriding it would throw away
     a deliberate camera position on every click. */
  const span = Math.max(maxx - minx, maxy - miny);
  const ratio = found === 1 && span === 0
    ? camera.ratio
    : Math.min(1, Math.max(opts.minRatio ?? MIN_RATIO, span * PADDING));

  camera.animate({ x, y, ratio }, { duration: opts.duration ?? 400 });
}

/**
 * Frame every visible node, centred on one of them.
 *
 * Two requirements that pull against each other: the origin should sit in the
 * middle, and nothing should be off screen. Fitting the graph's bounding box
 * satisfies the second alone and puts the origin wherever it happens to be;
 * centring on the origin satisfies the first alone and, at a fixed zoom, cuts
 * off whatever does not fit.
 *
 * So the box is built *around* the centre node rather than around the nodes:
 * its half-width is the distance to the furthest node on each axis, which
 * makes it symmetric by construction and large enough to hold everything.
 *
 * Unlike focusNodes this is not capped at a ratio of 1. A ratio of 1 shows the
 * graph's own bounding box, and a box centred on an off-centre origin is
 * necessarily larger than that — capping here is what would push nodes off the
 * edge.
 */
export function fitAround(sigma: Sigma, centreId: string, opts: FocusOptions = {}): void {
  const centre = sigma.getNodeDisplayData(centreId);
  if (!centre) return;

  let dx = 0;
  let dy = 0;
  sigma.getGraph().forEachNode((id) => {
    const d = sigma.getNodeDisplayData(id);
    /* Hidden nodes are filtered out of the view, so framing for them would
       leave the visible graph in a corner of empty space. */
    if (!d || d.hidden) return;
    dx = Math.max(dx, Math.abs(d.x - centre.x));
    dy = Math.max(dy, Math.abs(d.y - centre.y));
  });

  const span = 2 * Math.max(dx, dy);
  const ratio = span > 0
    ? Math.min(MAX_FIT_RATIO, Math.max(opts.minRatio ?? MIN_RATIO, span * PADDING))
    /* Nothing but the centre node is visible — a filter has emptied the graph.
       Hold the zoom rather than diving to the floor on a single point. */
    : sigma.getCamera().ratio;

  sigma.getCamera().animate(
    { x: centre.x, y: centre.y, ratio },
    { duration: opts.duration ?? 400 },
  );
}
