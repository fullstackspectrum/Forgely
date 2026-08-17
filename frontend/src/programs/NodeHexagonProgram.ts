/**
 * Custom hexagon node program for sigma v3.
 * Renders nodes as regular hexagons (flat-topped) using WebGL.
 */
import { NodeProgram, drawDiscNodeLabel } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { drawDarkNodeHover } from "../lib/hoverRenderer";
import { token } from "../lib/palette";

const { UNSIGNED_BYTE, FLOAT, TRIANGLES } = WebGLRenderingContext;

const VERTEX_SHADER = /*glsl*/ `
precision mediump float;

attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_cameraAngle;
uniform float u_correctionRatio;

varying vec4 v_color;

const float bias = 255.0 / 254.0;
const float sqrt_8 = sqrt(8.0);

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * sqrt_8;
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

const PI = Math.PI;
const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_cameraAngle", "u_matrix"] as const;

// A flat-topped regular hexagon is composed of 6 triangles sharing the centre.
// Each triangle has: centre (angle=0, radius=0), and two consecutive hex vertices.
// Hex vertex angles (flat-topped): 0, π/3, 2π/3, π, 4π/3, 5π/3
const HEX_ANGLES = [0, 1, 2, 3, 4, 5].map((i) => (i * PI) / 3);

// Build 6 triangles (18 vertices). Each vertex stores its angle (centre uses 0).
// Centre vertices have size factor 0, outer vertices have size factor 1.
// We encode [angle, sizeFactor] per constant vertex.
const CONSTANT_DATA: [number, number][] = [];
for (let i = 0; i < 6; i++) {
  // centre
  CONSTANT_DATA.push([0, 0]);
  // hex vertex i
  CONSTANT_DATA.push([HEX_ANGLES[i], 1]);
  // hex vertex i+1
  CONSTANT_DATA.push([HEX_ANGLES[(i + 1) % 6], 1]);
}

// We need a slightly different vertex shader that uses the sizeFactor
const VERTEX_SHADER_HEX = /*glsl*/ `
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

function drawHexagonNodeHover(
  context: CanvasRenderingContext2D,
  data: NodeDisplayData & { label?: string | null },
  settings: { labelSize: number; labelFont: string; labelWeight: string },
) {
  const { labelSize: size, labelFont: font, labelWeight: weight } = settings;
  context.font = `${weight} ${size}px ${font}`;

  context.fillStyle = token("--t-primary");
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 8;
  context.shadowColor = token("--fg-n-950");

  const PADDING = 2;
  const r = Math.max(data.size, size / 2) + PADDING;

  // Draw hexagon
  context.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const x = data.x + r * Math.cos(angle);
    const y = data.y + r * Math.sin(angle);
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  drawDiscNodeLabel(context, data, settings);
}

export class NodeHexagonProgram extends NodeProgram<typeof UNIFORMS[number]> {
  drawLabel = drawDiscNodeLabel;
  drawHover = drawDarkNodeHover;

  getDefinition() {
    return {
      VERTICES: 18 as const,
      VERTEX_SHADER_SOURCE: VERTEX_SHADER_HEX,
      FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
      METHOD: TRIANGLES,
      UNIFORMS,
      ATTRIBUTES: [
        { name: "a_position", size: 2, type: FLOAT },
        { name: "a_size", size: 1, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ] as const,
      CONSTANT_ATTRIBUTES: [
        { name: "a_angle", size: 1, type: FLOAT },
        { name: "a_sizeFactor", size: 1, type: FLOAT },
      ] as const,
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

  setUniforms(params: RenderParams, { gl, uniformLocations }: { gl: WebGLRenderingContext; uniformLocations: Record<string, WebGLUniformLocation> }) {
    const { u_sizeRatio, u_correctionRatio, u_cameraAngle, u_matrix } = uniformLocations;
    gl.uniform1f(u_sizeRatio, params.sizeRatio);
    gl.uniform1f(u_cameraAngle, params.cameraAngle);
    gl.uniform1f(u_correctionRatio, params.correctionRatio);
    gl.uniformMatrix3fv(u_matrix, false, params.matrix);
  }
}
