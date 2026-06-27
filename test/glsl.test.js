import { test } from "node:test";
import assert from "node:assert/strict";
import { isLowEffortGlsl, validateGlsl } from "../lib/glsl.js";

const CIRCLE_SHADERS = [
  `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
  float t = u_time * 0.6366;
  float pulse = sin(t);
  float size = 0.3 + 0.1 * pulse;
  float angle = 0.5 * pulse;
  vec2 rotated_uv = vec2(uv.x * cos(angle) - uv.y * sin(angle),
                        uv.x * sin(angle) + uv.y * cos(angle));
  float dist = length(rotated_uv);
  float mask = smoothstep(size, size - 0.02, dist);
  vec3 color = mix(vec3(0.8, 0.6, 0.7), vec3(0.6, 0.7, 0.8), pulse * 0.5 + 0.5);
  gl_FragColor = vec4(color * mask, 1.0);
}`,
  `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
  float t = u_time * 0.6366;
  float pulse = sin(t);
  float size = 0.3 + 0.1 * pulse;
  float dist = length(uv);
  float mask = smoothstep(size, size - 0.02, dist);
  float blur = exp(-dist * dist * 4.0);
  vec3 color = vec3(0.7, 0.8, 0.9);
  gl_FragColor = vec4(color * mask * blur, 1.0);
}`,
  `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
  float t = u_time * 0.6366;
  float pulse = sin(t);
  float size = 0.3 + 0.1 * pulse;
  float dist = length(uv);
  float mask = smoothstep(size, size - 0.02, dist);
  vec3 hsl = vec3((0.5 + 0.3 * pulse) * 0.01, 0.7, 0.6);
  vec3 color = hsl2rgb(hsl);
  gl_FragColor = vec4(color * mask, 1.0);
}`
];

const RICH_SHADER = `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  float a = atan(p.y, p.x);
  float r = length(p);
  float ripple = sin(r * 12.0 - u_time * 0.8 + a * 2.0) * 0.5 + 0.5;
  vec3 col = vec3(0.1, 0.2, 0.35) + vec3(0.3, 0.5, 0.7) * ripple;
  gl_FragColor = vec4(col, 1.0);
}`;

test("isLowEffortGlsl rejects pulsing circle placeholders", () => {
  for (const shader of CIRCLE_SHADERS) {
    assert.equal(isLowEffortGlsl(shader), true, "expected circle shader to be low-effort");
    const validation = validateGlsl(shader);
    assert.equal(validation.valid, false);
    assert.match(validation.reason, /low-effort/i);
  }
});

test("isLowEffortGlsl accepts full-frame ripple shaders", () => {
  assert.equal(isLowEffortGlsl(RICH_SHADER), false);
  assert.equal(validateGlsl(RICH_SHADER).valid, true);
});

test("isLowEffortGlsl rejects hard-cut ellipses and ring halos", () => {
  const ellipse = `precision mediump float;
uniform float u_time; uniform vec2 u_resolution; uniform vec2 u_mouse;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
  float t = u_time * 0.2;
  float d = length(uv / vec2(0.4, 0.2));
  vec3 col = vec3(0.0);
  if (d < 1.0) { col = vec3(fract(t * 0.1 + 0.5), 0.8, 0.7); }
  gl_FragColor = vec4(col, 1.0);
}`;
  const ring = `precision mediump float;
uniform float u_time; uniform vec2 u_resolution; uniform vec2 u_mouse;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
  float dist = length(uv);
  float ring = smoothstep(0.4, 0.42, dist) - smoothstep(0.48, 0.5, dist);
  vec3 col = vec3(fract(u_time * 0.1), 0.9, 0.8) * ring;
  gl_FragColor = vec4(col, 1.0);
}`;
  assert.equal(isLowEffortGlsl(ellipse), true);
  assert.equal(isLowEffortGlsl(ring), true);
});