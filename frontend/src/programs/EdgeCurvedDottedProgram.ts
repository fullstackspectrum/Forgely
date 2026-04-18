/**
 * Curved dotted edge program for sigma.js v3.
 * Based on @sigma/edge-curve but with a dashed/dotted pattern in the fragment shader.
 * Uses the Bezier curve parameter `t` to create consistent dash spacing regardless of edge length.
 */
import { EdgeProgram } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { NodeDisplayData, EdgeDisplayData } from "sigma/types";

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;

const DEFAULT_CURVATURE = 0.25;

// language=GLSL
const VERTEX_SHADER = /*glsl*/ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute float a_direction;
attribute float a_thickness;
attribute vec2 a_source;
attribute vec2 a_target;
attribute float a_current;
attribute float a_curvature;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform vec2 u_dimensions;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;

const float bias = 255.0 / 254.0;
const float epsilon = 0.7;

vec2 clipspaceToViewport(vec2 pos, vec2 dimensions) {
  return vec2(
    (pos.x + 1.0) * dimensions.x / 2.0,
    (pos.y + 1.0) * dimensions.y / 2.0
  );
}

vec2 viewportToClipspace(vec2 pos, vec2 dimensions) {
  return vec2(
    pos.x / dimensions.x * 2.0 - 1.0,
    pos.y / dimensions.y * 2.0 - 1.0
  );
}

void main() {
  float minThickness = u_minEdgeThickness;

  vec2 position = a_source * max(0.0, a_current) + a_target * max(0.0, 1.0 - a_current);
  position = (u_matrix * vec3(position, 1)).xy;

  vec2 source = (u_matrix * vec3(a_source, 1)).xy;
  vec2 target = (u_matrix * vec3(a_target, 1)).xy;

  vec2 viewportPosition = clipspaceToViewport(position, u_dimensions);
  vec2 viewportSource = clipspaceToViewport(source, u_dimensions);
  vec2 viewportTarget = clipspaceToViewport(target, u_dimensions);

  vec2 delta = viewportTarget.xy - viewportSource.xy;
  float len = length(delta);
  vec2 normal = vec2(-delta.y, delta.x) * a_direction;
  vec2 unitNormal = normal / len;
  float boundingBoxThickness = len * a_curvature;

  float curveThickness = max(minThickness, a_thickness / u_sizeRatio);
  v_thickness = curveThickness * u_pixelRatio;
  v_feather = u_feather;

  v_cpA = viewportSource;
  v_cpB = 0.5 * (viewportSource + viewportTarget) + unitNormal * a_direction * boundingBoxThickness;
  v_cpC = viewportTarget;

  vec2 viewportOffsetPosition = (
    viewportPosition +
    unitNormal * (boundingBoxThickness / 2.0 + sign(boundingBoxThickness) * (curveThickness + epsilon)) *
    max(0.0, a_direction)
  );

  position = viewportToClipspace(viewportOffsetPosition, u_dimensions);
  gl_Position = vec4(position, 0, 1);

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

// language=GLSL
const FRAGMENT_SHADER = /*glsl*/ `
precision highp float;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
const float DASH_PX = 8.0;
const float GAP_PX = 6.0;

float det(vec2 a, vec2 b) {
  return a.x * b.y - b.x * a.y;
}

/* Returns the curve parameter t (0..1) for the closest point on the Bezier */
float curveParam(vec2 b0, vec2 b1, vec2 b2) {
  float a = det(b0, b2), b = 2.0 * det(b1, b0), d = 2.0 * det(b2, b1);
  vec2 d21 = b2 - b1, d10 = b1 - b0, d20 = b2 - b0;
  vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);
  gf = vec2(gf.y, -gf.x);
  float f = b * d - a * a;
  vec2 pp = -f * gf / dot(gf, gf);
  vec2 d0p = b0 - pp;
  float ap = det(d0p, d20), bp = 2.0 * det(d10, d0p);
  return clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);
}

vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2) {
  float a = det(b0, b2), b = 2.0 * det(b1, b0), d = 2.0 * det(b2, b1);
  float f = b * d - a * a;
  vec2 d21 = b2 - b1, d10 = b1 - b0, d20 = b2 - b0;
  vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);
  gf = vec2(gf.y, -gf.x);
  vec2 pp = -f * gf / dot(gf, gf);
  vec2 d0p = b0 - pp;
  float ap = det(d0p, d20), bp = 2.0 * det(d10, d0p);
  float t = clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);
  return mix(mix(b0, b1, t), mix(b1, b2, t), t);
}

float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  return length(getDistanceVector(b0 - p, b1 - p, b2 - p));
}

/* Approximate arc length from 0..t using 5-point quadrature */
float arcLengthApprox(vec2 b0, vec2 b1, vec2 b2, float t) {
  // derivative of quadratic Bezier: B'(s) = 2(1-s)(b1-b0) + 2s(b2-b1)
  float total = 0.0;
  const int STEPS = 8;
  float prev = 0.0;
  for (int i = 1; i <= 8; i++) {
    float s = t * float(i) / 8.0;
    vec2 deriv = 2.0 * (1.0 - s) * (b1 - b0) + 2.0 * s * (b2 - b1);
    total += length(deriv);
  }
  return total * t / 8.0;
}

void main(void) {
  float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);
  float thickness = v_thickness;
  float halfThickness = thickness / 2.0;

  if (dist < halfThickness) {
    // Compute position along the curve in pixel space for dash pattern
    float t = curveParam(v_cpA - gl_FragCoord.xy, v_cpB - gl_FragCoord.xy, v_cpC - gl_FragCoord.xy);
    float arcLen = arcLengthApprox(v_cpA, v_cpB, v_cpC, t);
    float pattern = mod(arcLen, DASH_PX + GAP_PX);
    if (pattern > DASH_PX) {
      discard;
    }

    #ifdef PICKING_MODE
    gl_FragColor = v_color;
    #else
    float s = smoothstep(halfThickness - v_feather, halfThickness, dist);
    gl_FragColor = mix(v_color, transparent, s);
    #endif
  } else {
    gl_FragColor = transparent;
  }
}
`;

const UNIFORMS = [
  "u_matrix",
  "u_sizeRatio",
  "u_dimensions",
  "u_pixelRatio",
  "u_feather",
  "u_minEdgeThickness",
] as const;

class EdgeCurvedDottedProgram extends EdgeProgram<(typeof UNIFORMS)[number]> {
  getDefinition() {
    return {
      VERTICES: 6,
      VERTEX_SHADER_SOURCE: VERTEX_SHADER,
      FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
      METHOD: WebGLRenderingContext.TRIANGLES,
      UNIFORMS: UNIFORMS as unknown as Array<(typeof UNIFORMS)[number]>,
      ATTRIBUTES: [
        { name: "a_source", size: 2, type: FLOAT },
        { name: "a_target", size: 2, type: FLOAT },
        { name: "a_thickness", size: 1, type: FLOAT },
        { name: "a_curvature", size: 1, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [
        { name: "a_current", size: 1, type: FLOAT },
        { name: "a_direction", size: 1, type: FLOAT },
      ],
      CONSTANT_DATA: [
        [0, 1],
        [0, -1],
        [1, 1],
        [0, -1],
        [1, 1],
        [1, -1],
      ],
    };
  }

  processVisibleItem(
    edgeIndex: number,
    startIndex: number,
    sourceData: NodeDisplayData,
    targetData: NodeDisplayData,
    data: EdgeDisplayData,
  ) {
    const thickness = data.size || 1;
    const x1 = sourceData.x;
    const y1 = sourceData.y;
    const x2 = targetData.x;
    const y2 = targetData.y;
    const color = floatColor(data.color);
    const curvature = (data as any).curvature ?? DEFAULT_CURVATURE;

    const array = this.array;
    array[startIndex++] = x1;
    array[startIndex++] = y1;
    array[startIndex++] = x2;
    array[startIndex++] = y2;
    array[startIndex++] = thickness;
    array[startIndex++] = curvature;
    array[startIndex++] = color;
    array[startIndex++] = edgeIndex;
  }

  setUniforms(params: any, { gl, uniformLocations }: any) {
    const {
      u_matrix,
      u_sizeRatio,
      u_dimensions,
      u_pixelRatio,
      u_feather,
      u_minEdgeThickness,
    } = uniformLocations;

    gl.uniformMatrix3fv(u_matrix, false, params.matrix);
    gl.uniform1f(u_sizeRatio, params.sizeRatio);
    gl.uniform2f(u_dimensions, params.width * params.pixelRatio, params.height * params.pixelRatio);
    gl.uniform1f(u_pixelRatio, params.pixelRatio);
    gl.uniform1f(u_feather, params.antiAliasingFeather);
    gl.uniform1f(u_minEdgeThickness, params.minEdgeThickness);
  }
}

export default EdgeCurvedDottedProgram;
