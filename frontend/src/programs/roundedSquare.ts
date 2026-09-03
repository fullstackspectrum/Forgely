import { NodeProgram, drawDiscNodeLabel } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { drawDarkNodeHover, drawNodeLabel } from "../lib/hoverRenderer";

/**
 * Rounded-square nodes, matching the mark.
 *
 * The logo is a grid of rounded squares: blue cells around one ember cell that
 * is displaced and rotated. The graph uses the same vocabulary — the repository
 * is the ember cell, packages are the blue ones, and the tilt is reserved for
 * the node under investigation.
 *
 * Circles were doing none of that work, and the repository was a bitmap of the
 * whole logo clipped to a disc, which cut the mark off at its own boundary.
 *
 * Severity is a ring, and @sigma/node-border only draws circular ones — a disc
 * around a square reads as a halo, not an outline. So the ring is drawn here
 * instead, as a second fan of the same geometry at full size with the fill
 * inset by the ring width. The inset is computed in the vertex shader from
 * a_borderSize, which keeps the ring a constant pixel width at any node size:
 * width carries severity, and it has to stay comparable between a 16px node and
 * a 40px one.
 */

const { UNSIGNED_BYTE, FLOAT, TRIANGLES } = WebGLRenderingContext;

/** The mark's own proportion: 6px radius on a 26px cell. */
const CORNER_RATIO = 6 / 26;
/** Samples per rounded corner. */
const CORNER_STEPS = 8;
/** Outline points: four corners x (steps + 1). */
const OUTLINE_POINTS = 4 * (CORNER_STEPS + 1);
/** Two fans — ring then fill — of one triangle per outline segment. */
const VERTICES = OUTLINE_POINTS * 3 * 2;

/**
 * Rounded-square outline as (angle, radiusFactor) pairs.
 *
 * Built in Cartesian space — four corner arcs joined by straight edges — then
 * converted to polar, because the vertex shader positions each vertex as
 * `radius * (cos a, sin a)`. Radii are normalised so the widest point is 1.
 */
function outline(tiltRadians: number): [number, number][] {
  const s = 1;
  const r = CORNER_RATIO * 2 * s;
  const flat = s - r;

  const pts: [number, number][] = [];
  const corners: [number, number][] = [
    [flat, flat], [-flat, flat], [-flat, -flat], [flat, -flat],
  ];
  corners.forEach(([cx, cy], i) => {
    const start = (i * Math.PI) / 2;
    for (let k = 0; k <= CORNER_STEPS; k++) {
      const a = start + (k / CORNER_STEPS) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  });

  const max = Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
  return pts.map(([x, y]) => [Math.atan2(y, x) + tiltRadians, Math.hypot(x, y) / max]);
}

/** layer 0 = ring (full size, border colour), layer 1 = fill (inset). */
function constantData(tiltDegrees: number): [number, number, number][] {
  const pts = outline((tiltDegrees * Math.PI) / 180);
  const data: [number, number, number][] = [];
  for (const layer of [0, 1]) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      data.push([0, 0, layer]);
      data.push([a[0], a[1], layer]);
      data.push([b[0], b[1], layer]);
    }
  }
  return data;
}

const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_cameraAngle", "u_matrix"] as const;

const VERTEX_SHADER = /*glsl*/ `
precision mediump float;

attribute vec4 a_id;
attribute vec4 a_color;
attribute vec4 a_borderColor;
attribute vec2 a_position;
attribute float a_size;
attribute float a_borderSize;
attribute float a_angle;
attribute float a_sizeFactor;
attribute float a_layer;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_cameraAngle;
uniform float u_correctionRatio;

varying vec4 v_color;

const float bias = 255.0 / 254.0;
const float sqrt_8 = sqrt(8.0);

void main() {
  float full = a_size * u_correctionRatio / u_sizeRatio * sqrt_8;

  // The fill is inset by the ring width, expressed in the same units as the
  // node size so the ring stays a constant number of pixels regardless of how
  // large the node is.
  float ring = a_borderSize * u_correctionRatio / u_sizeRatio * sqrt_8;
  float inner = max(full - ring, full * 0.15);

  float radius = (a_layer < 0.5) ? full : inner;
  float size = radius * a_sizeFactor;

  // The tilt is baked into a_angle; u_cameraAngle keeps the mark upright
  // relative to the viewport when the camera rotates.
  float angle = a_angle + u_cameraAngle;
  vec2 diffVector = size * vec2(cos(angle), sin(angle));
  gl_Position = vec4((u_matrix * vec3(a_position + diffVector, 1)).xy, 0, 1);

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  // A zero-width ring would still paint the outer fan over the fill, so it
  // falls back to the fill colour rather than drawing border colour at full
  // size.
  v_color = (a_layer < 0.5 && a_borderSize > 0.0) ? a_borderColor : a_color;
  #endif

  v_color.a *= bias;
}
`;

const FRAGMENT_SHADER = /*glsl*/ `
precision mediump float;
varying vec4 v_color;
void main(void) {
  gl_FragColor = v_color;
}
`;

/** Build a rounded-square node program at a given tilt, in degrees. */
export function createRoundedSquareProgram(tiltDegrees: number) {
  const CONSTANT_DATA = constantData(tiltDegrees);
  if (CONSTANT_DATA.length !== VERTICES) {
    throw new Error(
      `roundedSquare: expected ${VERTICES} vertices, built ${CONSTANT_DATA.length}`,
    );
  }

  return class extends NodeProgram<(typeof UNIFORMS)[number]> {
    /* Sigma prefers a program's own drawLabel over
       settings.defaultDrawNodeLabel, so this has to be the shared renderer:
       leaving it on sigma's default silently ignored the setting the
       canvases were passing. */
    drawLabel = drawNodeLabel;
    drawHover = drawDarkNodeHover;

    getDefinition() {
      return {
        VERTICES,
        VERTEX_SHADER_SOURCE: VERTEX_SHADER,
        FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
        METHOD: TRIANGLES,
        UNIFORMS,
        ATTRIBUTES: [
          { name: "a_position", size: 2, type: FLOAT },
          { name: "a_size", size: 1, type: FLOAT },
          { name: "a_borderSize", size: 1, type: FLOAT },
          { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_borderColor", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
        ],
        CONSTANT_ATTRIBUTES: [
          { name: "a_angle", size: 1, type: FLOAT },
          { name: "a_sizeFactor", size: 1, type: FLOAT },
          { name: "a_layer", size: 1, type: FLOAT },
        ],
        CONSTANT_DATA,
      };
    }

    processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData) {
      const array = this.array;
      const attrs = data as NodeDisplayData & { borderColor?: string; borderSize?: number };
      array[startIndex++] = data.x;
      array[startIndex++] = data.y;
      array[startIndex++] = data.size;
      array[startIndex++] = attrs.borderSize ?? 0;
      array[startIndex++] = floatColor(data.color);
      array[startIndex++] = floatColor(attrs.borderColor || data.color);
      array[startIndex++] = nodeIndex;
    }

    setUniforms(
      params: RenderParams,
      { gl, uniformLocations }: { gl: WebGLRenderingContext; uniformLocations: Record<string, WebGLUniformLocation> },
    ) {
      const { u_sizeRatio, u_correctionRatio, u_cameraAngle, u_matrix } = uniformLocations;
      gl.uniform1f(u_sizeRatio, params.sizeRatio);
      gl.uniform1f(u_cameraAngle, params.cameraAngle);
      gl.uniform1f(u_correctionRatio, params.correctionRatio);
      gl.uniformMatrix3fv(u_matrix, false, params.matrix);
    }
  };
}

/** Packages and the repository: upright, as the logo's cells are. */
export const NodeSquareProgram = createRoundedSquareProgram(0);
/** The node under investigation: displaced, as the logo's centre cell is. */
export const NodeTiltedSquareProgram = createRoundedSquareProgram(12);
