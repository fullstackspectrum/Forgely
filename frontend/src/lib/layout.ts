import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

/* ForceAtlas2, split into two halves.
 *
 * placeRadially() is cheap (0.8ms on 7,544 nodes) and produces a usable
 * picture on its own. refineForceLayout() does the expensive part in slices
 * so the main thread is never blocked for long.
 *
 * Measured on a 10,400-package language repository (7,544 nodes, 99 iterations
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
 * the container repository, 800 iterations from an identical scatter:
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
 * the language repository (7,544 nodes, a star — 97.9% of edges on the hub) projects to
 * 0.017px over its whole budget, while the container repository (203 nodes, clustered)
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

/* Space every node has to itself, in screen pixels, on top of its own radius.
 *
 * ForceAtlas2's adjustSizes only discourages overlap through repulsion; it
 * does not forbid it, and on a clustered graph it loses to gravity. This pass
 * makes it a hard constraint after the fact. */
const NODE_GAP_PX = 6;

/* Assumed width of the graph viewport, in CSS pixels.
 *
 * Node sizes are given in pixels while positions are in graph units, so a
 * scale is needed to compare them. Sigma fits the whole layout to the viewport
 * at ratio 1, which makes the conversion span/viewport. Only the ratio of gap
 * to layout matters, so an approximate width is enough — and a fixed one keeps
 * the layout reproducible rather than depending on the window it was first
 * drawn in. */
const ASSUMED_VIEWPORT_PX = 1200;

/* Relaxation passes. Each pass separates every overlapping pair it finds, but
 * moving a node can push it into a third, so it converges rather than solving
 * in one shot. The loop exits early once nothing overlaps. */
const MAX_SEPARATION_PASSES = 200;

/* Give up after this many passes without an improvement.
 *
 * Two ways a run stops making progress. A pair can sit just inside the
 * required gap and oscillate across it forever, which is harmless and done
 * after a handful of passes. Or the graph genuinely cannot satisfy the
 * constraint — 7,001 nodes at 20px want 175% of the viewport — and passes 20
 * through 200 buy almost nothing for most of the cost. Both are the same
 * signal: the count stopped falling. */
const STALL_PASSES = 8;

/* A pass has to remove this share of the remaining overlaps to count as
 * progress. A graph that cannot satisfy the constraint still chips away a
 * fraction of a percent per pass forever — on the language repository that is 200
 * passes and 1.7 seconds to halve a number that was never going to reach
 * zero. Requiring real progress stops it while it is still worth doing. */
const STALL_IMPROVEMENT = 0.02;

/**
 * Push nodes apart until none overlaps another.
 *
 * A uniform grid keeps this near linear: cells are one maximum diameter wide,
 * so a node can only collide with something in its own cell or the eight
 * around it, and the alternative — every pair — is 28 million comparisons on
 * the language repository.
 *
 * The layout expands where it has to. That is the point: the constraint is
 * measured against the span the layout settled at, so satisfying it can only
 * mean taking more room, and sigma fits whatever comes out back to the
 * viewport afterwards.
 *
 * What this cannot do is make a graph fit that does not: 7,001 nodes at 20px
 * cover 175% of a 1400x900 viewport, so at fit-all they must overlap whatever
 * any layout does. What it removes is *clumping*, which is scale-free — a
 * clump stays a clump at every zoom level, while an evenly spread graph
 * separates as soon as you zoom in.
 */
export interface Separation {
  /** Run `passes` relaxation passes. Returns true once there is no more to do. */
  step(passes: number): boolean;
  /** Passes run so far. */
  readonly passes: number;
  /** Pairs still closer than the required gap, once finished. */
  readonly unresolved: number;
}

/**
 * Begin separating overlapping nodes, one slice at a time.
 *
 * Sliced for the same reason the force layout is: a pass over 7,001 nodes
 * costs about 10ms, and running to completion in one go blocks for half a
 * second. State is held here rather than re-derived per slice, so the pixel
 * scale stays fixed at the span the layout settled at — recomputing it as the
 * graph spreads would make the constraint chase its own tail.
 */
export function beginSeparation(graph: Graph, viewportPx = ASSUMED_VIEWPORT_PX): Separation {
  const ids: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const radii: number[] = [];

  graph.forEachNode((id, a) => {
    /* Echo rings are pinned to their parent every frame and would fight this
       for the same space. */
    if (a.nodeType === "echo") return;
    ids.push(id);
    xs.push(a.x as number);
    ys.push(a.y as number);
    radii.push(((a.size as number) ?? 1) / 2);
  });

  const n = ids.length;
  const span = n < 2 ? 0 : layoutSpan(xs.map((x, i) => ({ x, y: ys[i] })));

  let passes = 0;
  let unresolved = 0;
  let best = Infinity;
  let stalled = 0;
  let finished = n < 2 || !span;

  const unitsPerPx = span / viewportPx;
  const pad = NODE_GAP_PX * unitsPerPx;
  const r = radii.map((v) => v * unitsPerPx);
  const cell = finished ? 1 : Math.max(2 * Math.max(...r) + pad, span / 1000);

  const commit = () => {
    for (let i = 0; i < n; i++) {
      graph.setNodeAttribute(ids[i], "x", xs[i]);
      graph.setNodeAttribute(ids[i], "y", ys[i]);
    }
  };

  /* One relaxation pass. A uniform grid keeps it near linear: cells are one
     maximum diameter wide, so a node can only collide with something in its
     own cell or the eight around it. Comparing every pair instead is 24
     million tests on the language repository. */
  const onePass = (): number => {
    let minx = Infinity, miny = Infinity;
    for (let i = 0; i < n; i++) {
      if (xs[i] < minx) minx = xs[i];
      if (ys[i] < miny) miny = ys[i];
    }
    const key = (cx: number, cy: number) => cx * 1e6 + cy;
    const cellX = (i: number) => Math.floor((xs[i] - minx) / cell);
    const cellY = (i: number) => Math.floor((ys[i] - miny) / cell);

    const buckets = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const k = key(cellX(i), cellY(i));
      const b = buckets.get(k);
      if (b) b.push(i);
      else buckets.set(k, [i]);
    }

    let collisions = 0;
    for (let i = 0; i < n; i++) {
      const cx = cellX(i);
      const cy = cellY(i);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const b = buckets.get(key(cx + dx, cy + dy));
          if (!b) continue;
          for (const j of b) {
            if (j <= i) continue; // each pair once
            const min = r[i] + r[j] + pad;
            let ddx = xs[j] - xs[i];
            let ddy = ys[j] - ys[i];
            let d = Math.hypot(ddx, ddy);
            if (d >= min) continue;
            collisions++;
            if (d === 0) {
              /* Exactly coincident, which the radial scatter can produce. Any
                 direction will do, but it has to be deterministic or the same
                 graph lays out differently on each load. */
              ddx = Math.cos(i);
              ddy = Math.sin(i);
              d = 1;
            }
            const push = (min - d) / 2 / d;
            xs[i] -= ddx * push;
            ys[i] -= ddy * push;
            xs[j] += ddx * push;
            ys[j] += ddy * push;
          }
        }
      }
    }
    return collisions;
  };

  return {
    get passes() { return passes; },
    get unresolved() { return unresolved; },
    step(count: number): boolean {
      if (finished) return true;
      for (let k = 0; k < count; k++) {
        const collisions = onePass();
        passes++;
        if (collisions === 0) {
          finished = true;
          break;
        }
        if (collisions < best * (1 - STALL_IMPROVEMENT)) {
          best = collisions;
          stalled = 0;
        } else if (++stalled >= STALL_PASSES || passes >= MAX_SEPARATION_PASSES) {
          finished = true;
          unresolved = collisions;
          break;
        }
      }
      commit();
      return finished;
    },
  };
}

/** Run separation to completion. Blocking; used by tests and small graphs. */
export function resolveOverlaps(
  graph: Graph,
  viewportPx = ASSUMED_VIEWPORT_PX,
): { passes: number; unresolved: number } {
  const sep = beginSeparation(graph, viewportPx);
  while (!sep.step(1)) { /* keep going */ }
  return { passes: sep.passes, unresolved: sep.unresolved };
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
  /** Called after each separation pass, to repaint while nodes are moving. */
  onSeparationStep?: () => void,
): () => void {
  const total = graph.order;

  // Iteration budget, scaled *down* with size — not up.
  //
  // The previous `Math.min(800, 350 + total * 2)` gave larger graphs more
  // iterations, but FA2 costs O(iterations x N log N): big graphs paid more
  // per iteration AND ran more of them, while needing them least.
  //
  // Measured on a 10,400-package language repository (7,544 nodes): 800
  // iterations took 17.4s and left every node within 0.07% of where 50
  // iterations put it. That graph is a star — 97.9% of edges hang off the repo
  // node, mean degree elsewhere 1.04 — so the radial pre-placement above
  // already lands it near equilibrium and the remaining iterations refine
  // nothing.
  //
  // Small, genuinely clustered graphs keep the full budget: the container repository
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

  /* Separation runs after the force layout, not during it: FA2 would undo it
     on the next iteration, and it only makes sense against a settled span. */
  const separate = () => {
    if (cancelled) return;
    const sep = beginSeparation(graph);
    const tick = () => {
      if (cancelled) return;
      /* One pass per frame. A pass costs ~10ms on 7,001 nodes, so a bigger
         slice drops frames on exactly the graphs that need the most passes. */
      if (sep.step(1)) {
        centreOn(graph, repoNode);
        onSettled?.();
        return;
      }
      centreOn(graph, repoNode);
      onSeparationStep?.();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const finish = () => {
    if (cancelled) return;
    centreOn(graph, repoNode);
    separate();
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
       on the language repository this is the difference between 30ms and 3.3s.

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
