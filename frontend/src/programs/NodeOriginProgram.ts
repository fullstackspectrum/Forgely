/**
 * The origin node — the one thing under investigation.
 *
 * BRANDING.md §1: "One origin per view. The user is always investigating
 * *something*... That thing is the ember cell. It is marked in amber, it is
 * tilted, and there is exactly one of it on screen."
 *
 * §6 pins the treatment down: 22px, ember-filled, rotated 12 degrees, and a
 * rounded square rather than a circle — "shape distinguishes it even in
 * greyscale". That last clause is why this is a separate program rather than a
 * recoloured disc: the graph is full of coloured circles, and colour is exactly
 * the channel that fails when desaturated.
 *
 * The 12 degrees is not styling. README: "The rotation is not decoration. It is
 * what makes the centre cell read as displaced rather than merely a different
 * colour. Do not straighten it in any cleanup, redraw, or animation resting
 * state."
 *
 * Geometry follows NodeHexagonProgram: a triangle fan from the centre, with
 * each outline vertex carrying its own angle and radius factor.
 */
import { NodeProgram, drawDiscNodeLabel } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { drawDarkNodeHover } from "../lib/hoverRenderer";

const { UNSIGNED_BYTE, FLOAT, TRIANGLES } = WebGLRenderingContext;

/** The mark's own proportion: 6px radius on a 26px cell. */
const CORNER_RATIO = 6 / 26;
/** Displacement angle of the compromised cell. */
const TILT = (12 * Math.PI) / 180;
/** Samples per rounded corner. Eight is smooth at 22px and costs 48 triangles. */
const CORNER_STEPS = 8;

/**
 * Outline of a rounded square as (angle, radiusFactor) pairs.
 *
 * Built in Cartesian space — four corner arcs joined by straight edges — then
 * converted to polar, because the vertex shader positions each vertex as
 * `radius * (cos a, sin a)`. Radii are normalised so the widest point is 1.
 */
function roundedSquareOutline(): [number, number][] {
  const s = 1;                       // half-extent
  const r = CORNER_RATIO * 2 * s;    // corner radius
  const flat = s - r;                // where the straight edge ends

  const pts: [number, number][] = [];
  // Corner centres, counter-clockwise from the +x/+y quadrant.
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
  return pts.map(([x, y]) => [Math.atan2(y, x) + TILT, Math.hypot(x, y) / max]);
}

const OUTLINE = roundedSquareOutline();

/* Fan: centre plus each consecutive pair of outline points. */
const CONSTANT_DATA: [number, number][] = [];
for (let i = 0; i < OUTLINE.length; i++) {
  const a = OUTLINE[i];
  const b = OUTLINE[(i + 1) % OUTLINE.length];
  CONSTANT_DATA.push([0, 0]);
  CONSTANT_DATA.push([a[0], a[1]]);
  CONSTANT_DATA.push([b[0], b[1]]);
}

/* Must be a literal for sigma's typing. 4 corners x (CORNER_STEPS + 1)
   outline points, each fanned into a triangle with the next: 36 x 3. */
const VERTICES = 108 as const;
if (CONSTANT_DATA.length !== VERTICES) {
  throw new Error(
    `NodeOriginProgram: expected ${VERTICES} vertices, built ${CONSTANT_DATA.length}. ` +
    "CORNER_STEPS changed without updating VERTICES.",
  );
}

const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_cameraAngle", "u_matrix"] as const;

const VERTEX_SHADER = /*glsl*/ `
precision mediump float;

attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;
attribute float a_sizeFactor;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_cameraAngle;
uniform float u_correctionRatio;

varying vec4 v_color;

const float bias = 255.0 / 254.0;
const float sqrt_8 = sqrt(8.0);

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * sqrt_8 * a_sizeFactor;
  // The tilt is baked into a_angle. u_cameraAngle is added so the mark stays
  // upright relative to the viewport when the camera rotates — the tilt must
  // read against the graph, not spin with it.
  float angle = a_angle + u_cameraAngle;
  vec2 diffVector = size * vec2(cos(angle), sin(angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
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

export class NodeOriginProgram extends NodeProgram<(typeof UNIFORMS)[number]> {
  drawLabel = drawDiscNodeLabel;
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
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [
        { name: "a_angle", size: 1, type: FLOAT },
        { name: "a_sizeFactor", size: 1, type: FLOAT },
      ],
      CONSTANT_DATA,
    };
  }

  processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData) {
    const array = this.array;
    const color = floatColor(data.color);
    array[startIndex++] = data.x;
    array[startIndex++] = data.y;
    array[startIndex++] = data.size;
    array[startIndex++] = color;
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
}
