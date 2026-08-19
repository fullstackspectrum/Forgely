/**
 * Custom triangle node program for sigma v3.
 * Renders nodes as upward-pointing triangles using WebGL.
 */
import { NodeProgram, drawDiscNodeLabel } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import type { Settings } from "sigma/settings";
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

function drawTriangleNodeHover(
  context: CanvasRenderingContext2D,
  data: NodeDisplayData & { label?: string | null },
  settings: Settings,
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

  if (typeof data.label === "string") {
    const textWidth = context.measureText(data.label).width;
    const boxWidth = Math.round(textWidth + 5);
    const boxHeight = Math.round(size + 2 * PADDING);

    context.beginPath();
    context.moveTo(data.x, data.y - r);
    context.lineTo(data.x + r, data.y + r);
    context.lineTo(data.x + r, data.y + boxHeight / 2);
    context.lineTo(data.x + r + boxWidth, data.y + boxHeight / 2);
    context.lineTo(data.x + r + boxWidth, data.y - boxHeight / 2);
    context.lineTo(data.x + r, data.y - boxHeight / 2);
    context.lineTo(data.x + r, data.y + r);
    context.lineTo(data.x - r, data.y + r);
    context.closePath();
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(data.x, data.y - r);
    context.lineTo(data.x + r, data.y + r);
    context.lineTo(data.x - r, data.y + r);
    context.closePath();
    context.fill();
  }

  context.shadowBlur = 0;
  drawDiscNodeLabel(context, data, settings);
}

export class NodeTriangleProgram extends NodeProgram<typeof UNIFORMS[number]> {
  drawLabel = drawDiscNodeLabel;
  drawHover = drawDarkNodeHover;

  getDefinition() {
    return {
      VERTICES: 3 as const,
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
      CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: FLOAT }] as const,
      // 3 corners of an equilateral triangle pointing up
      CONSTANT_DATA: [
        [PI / 2],        // top
        [-PI / 6],       // bottom-right
        [(-5 * PI) / 6], // bottom-left
      ],
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
