/**
 * Custom ring node program for sigma v3.
 * Renders nodes as hollow circular rings (stroke only, no fill) using WebGL.
 * The ring's stroke thickness is fixed in screen-space pixels for crisp edges
 * regardless of zoom.
 */
import { NodeProgram, drawDiscNodeLabel } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { drawDarkNodeHover, drawNodeLabel } from "../lib/hoverRenderer";

const { UNSIGNED_BYTE, FLOAT, TRIANGLES } = WebGLRenderingContext;

// Two triangles forming a unit quad centred at origin: corners at (±1, ±1).
// Each vertex stores its local offset (a_offset) used to compute the position
// and the distance from the centre in the fragment shader.
const CONSTANT_DATA: [number, number][] = [
  [-1, -1], [1, -1], [1, 1],
  [-1, -1], [1, 1], [-1, 1],
];

const VERTEX_SHADER = /*glsl*/ `
precision mediump float;

attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute vec2 a_offset;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_offset;
varying float v_radiusPx;

const float bias = 255.0 / 254.0;
const float sqrt_8 = sqrt(8.0);

void main() {
  // Match the size convention used by sigma's built-in disc program.
  float size = a_size * u_correctionRatio / u_sizeRatio * sqrt_8;
  vec2 position = a_position + size * a_offset;
  gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);

  v_offset = a_offset;
  // Approximate on-screen radius in (clip-space-ish) units used for stroke width.
  v_radiusPx = a_size / u_sizeRatio;

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
varying vec2 v_offset;
varying float v_radiusPx;

void main(void) {
  // Distance from centre in normalised (0..1 at the ring radius) units.
  float d = length(v_offset);

  // Stroke half-width as a fraction of the radius. Keep the ring thin even
  // for large radii so it reads as a clean outline.
  // ~2px ring on a ~40px radius ≈ 0.05; clamp to a reasonable range.
  float halfWidth = clamp(1.5 / max(v_radiusPx, 1.0), 0.015, 0.12);

  // Smooth anti-aliased ring band centred on d == 1.0 - halfWidth.
  float ringCenter = 1.0 - halfWidth;
  float dist = abs(d - ringCenter);
  // Fixed AA falloff (small fraction of radius) — avoids needing derivatives.
  float aa = halfWidth * 0.35;
  float alpha = 1.0 - smoothstep(halfWidth - aa, halfWidth, dist);

  if (alpha <= 0.0) discard;

  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_matrix"] as const;

export class NodeRingProgram extends NodeProgram<typeof UNIFORMS[number]> {
  /* Sigma prefers a program's own drawLabel over
     settings.defaultDrawNodeLabel, so this has to be the shared renderer:
     leaving it on sigma's default silently ignored the setting the
     canvases were passing. */
  drawLabel = drawNodeLabel;
  drawHover = drawDarkNodeHover;

  getDefinition() {
    return {
      VERTICES: 6 as const,
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
        { name: "a_offset", size: 2, type: FLOAT },
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
    const { u_sizeRatio, u_correctionRatio, u_matrix } = uniformLocations;
    gl.uniform1f(u_sizeRatio, params.sizeRatio);
    gl.uniform1f(u_correctionRatio, params.correctionRatio);
    gl.uniformMatrix3fv(u_matrix, false, params.matrix);
  }
}
