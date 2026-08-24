import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

/* ForceAtlas2, split into two halves.
 *
 * placeRadially() is cheap (0.8ms on 7,544 nodes) and produces a usable
 * picture on its own. refineForceLayout() does the expensive part in slices
 * so the main thread is never blocked for long.
 *
 * Measured on full-stack-spectrum/neuro-packages (7,544 nodes, 99 iterations
 * after the perf/14 budget): a single forceAtlas2.assign call blocks for
 * 3.3–4.0s. One iteration on that graph costs 22–33ms, so a slice cannot be
 * made shorter than one iteration — but 31ms is a dropped frame, where 3.3s
 * is a frozen tab.
 */

/* Target block length for one chunk of iterations. */
const FRAME_BUDGET_MS = 12;

/* Iterations per forceAtlas2.assign call.
 *
 * This is NOT a free knob. FA2 ramps an adaptive local speed over the course
 * of a call and reinitialises it on the next one, so chunking changes the
 * result — the smaller the chunk, the less the layout settles. Measured on
 * neuro-containers, 800 iterations from an identical scatter:
 *
 *     chunk    net movement    distance from one 800-iteration call
 *         1           0.68%                                  5.63%
 *         5           5.18%                                  1.10%
 *        10           5.78%                                  0.55%
 *        25           6.15%                                  0.21%
 *       800           6.39%                                      —
 *
 * Below ~5 the layout is visibly under-settled. The floor is therefore a
 * correctness bound, not a performance one; the ceiling just stops a chunk
 * from monopolising a frame on graphs with expensive iterations.
 */
const MIN_CHUNK = 5;
const MAX_CHUNK = 25;

/* Skip the run entirely when it cannot change what is on screen.
 *
 * A rendering bound rather than a tuned constant: the graph is fitted to a
 * viewport on the order of 1,000px, so half a pixel is about 1/2000th of the
 * layout's span.
 *
 * FA2 does not converge here — per-iteration movement is flat to three
 * significant figures across an entire run on both real graphs, so there is no
 * decay to detect and no point checking repeatedly. What differs is the rate.
 * One iteration is enough to tell the two cases apart by a factor of ~400:
 * neuro-packages (7,544 nodes, a star — 97.9% of edges on the hub) projects to
 * 0.017px over its whole budget, while neuro-containers (203 nodes, clustered)
 * projects to 6.9px.
 */
const SUBPIXEL_SPAN_FRACTION = 1 / 2000;

export interface Point { x: number; y: number }

/**
 * Positions for `count` nodes packed around a centre, in concentric rings.
 *
 * Used when a package group is opened: its versions have to appear to come out
 * of the node that was clicked, so they are placed around where that node sat
 * rather than being handed to the global layout, which would scatter them
 * across the canvas with no visible relationship to the click.
 *
 * A single ring does not survive contact with real data — fifty versions of
 * `library/node` on one circle either overlap or make a ring wider than the
 * rest of the graph. Ring k sits at radius k*spacing and holds about 6k slots,
 * which keeps neighbours roughly `spacing` apart however many there are.
 */
export function clusterAround(centre: Point, count: number, spacing: number): Point[] {
  const out: Point[] = [];
  let ring = 1;
  while (out.length < count) {
    const capacity = Math.max(1, Math.floor(2 * Math.PI * ring));
    const n = Math.min(capacity, count - out.length);
    const radius = ring * spacing;
    /* The last ring is usually a partial one. Spreading those few over the
       whole circle rather than filling the ring's first n slots keeps the
       cluster symmetric about the node that was clicked — otherwise the
       leftovers bunch to one side and the group appears to lean away. */
    const slots = n < capacity ? n : capacity;
    /* Odd rings are offset by half a step so nodes do not line up radially
       into spokes. */
    const phase = (ring % 2) * (Math.PI / slots);
    for (let i = 0; i < n; i++) {
      const a = (i / slots) * 2 * Math.PI + phase;
      out.push({ x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius });
    }
    ring++;
  }
  return out;
}

/**
 * Gap between opened versions, as a fraction of the layout's extent.
 *
 * Relative rather than absolute because the two real graphs differ in extent
 * by an order of magnitude, and a constant that suits one crowds the other.
 * A fifty-version group fills four rings, so the cluster reaches about
 * 4 x this — roughly a fifth of the graph's width, which is enough to read the
 * versions and their labels as separate nodes without the group taking over
 * the canvas.
 */
export const GROUP_SPACING_FRACTION = 0.05;

/** Minimum gap, for graphs small enough that the fraction goes to nothing. */
const MIN_GROUP_SPACING = 30;

/** How far apart to place the versions of a group opened in `graph`. */
export function groupSpacing(positions: Iterable<Point>): number {
  return Math.max(layoutSpan(positions) * GROUP_SPACING_FRACTION, MIN_GROUP_SPACING);
}

/** Largest extent of the laid-out nodes, used to scale distances to a graph. */
export function layoutSpan(positions: Iterable<Point>): number {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const { x, y } of positions) {
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  if (!Number.isFinite(minx)) return 0;
  return Math.max(maxx - minx, maxy - miny);
}

/**
 * Repo node at the origin, everything else scattered in a ring around it.
 *
 * `seed` holds positions a node must keep. Opening a package group rebuilds
 * the graph, and without seeding, every other node would be re-scattered and
 * re-settled — the picture the user was reading jumps, and the versions that
 * appeared have no visible connection to the node they came from.
 */
export function placeRadially(graph: Graph, seed?: Map<string, Point>): string | null {
  let repoNode: string | null = null;
  graph.forEachNode((id, attrs) => {
    if (attrs.nodeType === "repo") repoNode = id;
  });

  // Radial scatter: repo at origin, everything else placed in a ring with
  // random angle + distance variation so FA2 starts from a circular cloud
  // rather than a square one (which it struggles to escape).
  const total = graph.order;
  const baseRadius = Math.max(250, total * 10);
  let idx = 0;
  graph.forEachNode((id) => {
    const known = seed?.get(id);
    if (known) {
      graph.setNodeAttribute(id, "x", known.x);
      graph.setNodeAttribute(id, "y", known.y);
      return;
    }
    if (id === repoNode) {
      graph.setNodeAttribute(id, "x", 0);
      graph.setNodeAttribute(id, "y", 0);
      return;
    }
    // Spread evenly around the circle with a random offset so no two nodes
    // start at the same angle, plus a random radial distance band.
    const angle = (idx / Math.max(1, total - 1)) * 2 * Math.PI + (Math.random() - 0.5) * 1.5;
    const r = baseRadius * (0.4 + Math.random() * 0.9);
    graph.setNodeAttribute(id, "x", Math.cos(angle) * r);
    graph.setNodeAttribute(id, "y", Math.sin(angle) * r);
    idx++;
  });

  return repoNode;
}

/** Translate every node so `node` sits exactly at the origin. */
function centreOn(graph: Graph, node: string | null): void {
  if (!node || !graph.hasNode(node)) return;
  const ox = graph.getNodeAttribute(node, "x") as number;
  const oy = graph.getNodeAttribute(node, "y") as number;
  if (ox === 0 && oy === 0) return;
  graph.forEachNode((id) => {
    graph.setNodeAttribute(id, "x", (graph.getNodeAttribute(id, "x") as number) - ox);
    graph.setNodeAttribute(id, "y", (graph.getNodeAttribute(id, "y") as number) - oy);
  });
}

function snapshot(graph: Graph): Float64Array {
  const out = new Float64Array(graph.order * 2);
  let i = 0;
  graph.forEachNode((_, a) => {
    out[i++] = a.x as number;
    out[i++] = a.y as number;
  });
  return out;
}

/** Mean node movement since `before`, as a fraction of the layout's extent. */
function movedFraction(graph: Graph, before: Float64Array): number {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  let sum = 0, i = 0;
  graph.forEachNode((_, a) => {
    const x = a.x as number, y = a.y as number;
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
    sum += Math.hypot(x - before[i], y - before[i + 1]);
    i += 2;
  });
  const span = Math.max(maxx - minx, maxy - miny);
  if (!span || !graph.order) return 0;
  return sum / graph.order / span;
}

/**
 * Settle the layout across animation frames.
 *
 * Callers are expected to already have run placeRadially. Returns a cancel
 * function; call it on unmount, on a data change, or when switching layouts.
 *
 * `onSettled` fires once the layout stops — use it to reindex or refit the
 * camera, both of which are wasted work while nodes are still moving.
 */
export function refineForceLayout(
  graph: Graph,
  repoNode: string | null,
  onSettled?: () => void,
): () => void {
  const total = graph.order;

  // Iteration budget, scaled *down* with size — not up.
  //
  // The previous `Math.min(800, 350 + total * 2)` gave larger graphs more
  // iterations, but FA2 costs O(iterations x N log N): big graphs paid more
  // per iteration AND ran more of them, while needing them least.
  //
  // Measured on full-stack-spectrum/neuro-packages (7,544 nodes): 800
  // iterations took 17.4s and left every node within 0.07% of where 50
  // iterations put it. That graph is a star — 97.9% of edges hang off the repo
  // node, mean degree elsewhere 1.04 — so the radial pre-placement above
  // already lands it near equilibrium and the remaining iterations refine
  // nothing.
  //
  // Small, genuinely clustered graphs keep the full budget: neuro-containers
  // (215 nodes, mean degree 11.1) is still improving at 780 iterations, and the
  // entire run costs 175ms, so there is nothing worth saving there.
  let remaining = Math.min(800, Math.max(50, Math.round(750000 / total)));

  const settings = {
    gravity: 0.15,
    scalingRatio: 14,
    adjustSizes: true,
    barnesHutOptimize: total > 150,
    // strongGravityMode applies a constant pull toward the origin on every
    // node, which counteracts repulsion drift and keeps the cluster circular.
    strongGravityMode: true,
    slowDown: 1 + Math.log(total + 1),
  };

  let raf = 0;
  let cancelled = false;

  const finish = () => {
    if (cancelled) return;
    centreOn(graph, repoNode);
    onSettled?.();
  };

  /* Probe: one iteration, timed and measured. Tells us both how much this
     graph is going to move and how much a chunk can afford to do. */
  const before = snapshot(graph);
  const t0 = performance.now();
  forceAtlas2.assign(graph, { iterations: 1, settings });
  const msPerIteration = performance.now() - t0;
  remaining--;

  const projected = movedFraction(graph, before) * remaining;
  if (projected <= SUBPIXEL_SPAN_FRACTION) {
    /* The scatter already is the layout. Bail before spending the budget —
       on neuro-packages this is the difference between 30ms and 3.3s.

       Still deferred a frame: onSettled firing synchronously, before the
       caller holds the cancel handle it is being returned, is the kind of
       asymmetry that only shows up on one graph and not the other. */
    raf = requestAnimationFrame(finish);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }

  const sizeChunk = (msPerIter: number) =>
    Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Math.round(FRAME_BUDGET_MS / Math.max(msPerIter, 0.01))));

  /* The probe is the first FA2 call on this graph, so it pays JIT warmup and
     the initial Barnes-Hut tree build — it reads several times slower than
     steady state and would peg the chunk at the floor. Start from its estimate
     but re-size against every chunk's real duration, which settles by the
     second frame. */
  let chunk = sizeChunk(msPerIteration);

  const step = () => {
    if (cancelled) return;
    const n = Math.min(chunk, remaining);
    const started = performance.now();
    forceAtlas2.assign(graph, { iterations: n, settings });
    chunk = sizeChunk((performance.now() - started) / n);
    remaining -= n;
    centreOn(graph, repoNode);
    if (remaining > 0) {
      raf = requestAnimationFrame(step);
    } else {
      finish();
    }
  };

  raf = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
