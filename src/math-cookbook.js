// Math cookbook — real, well-commented GLSL snippets that the generation
// prompt includes verbatim. Gemini can reference, remix, and recombine
// these. Every snippet is WebGL 1.0 compatible (precision mediump float,
// no extensions, no out vec4).

export const MATH_COOKBOOK = `
// ─── Hash functions (deterministic pseudo-random) ───────────────────────

// Classic 2D hash: sin-based, fast, good enough for noise seeds.
// Iñigo Quilez's canonical implementation.
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// 2D→2D hash: returns a vec2 in [0,1]. Use when you need a 2D random vector
// (e.g. for gradient noise or domain warp offset).
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// 3D hash: extend hash21 to 3D. Useful for volumetric effects or when
// you need a stable seed for a third dimension (e.g. time as z).
float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

// ─── Value noise (smooth pseudo-random field) ──────────────────────────

// 2D value noise: interpolate 4 corner hash values with a smooth curve.
// Cheaper than gradient noise (Perlin) and good enough for most shaders.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep — C1 continuous
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 3D value noise: for time-varying 2D fields, pass (uv, time) as 3D input.
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash31(i);
  float b = hash31(i + vec3(1.0, 0.0, 0.0));
  float c = hash31(i + vec3(0.0, 1.0, 0.0));
  float d = hash31(i + vec3(1.0, 1.0, 0.0));
  float e = hash31(i + vec3(0.0, 0.0, 1.0));
  float f1 = hash31(i + vec3(1.0, 0.0, 1.0));
  float g = hash31(i + vec3(0.0, 1.0, 1.0));
  float h = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(mix(e, f1, u.x), mix(g, h, u.x), u.y),
    u.z
  );
}

// ─── FBM (Fractal Brownian Motion) ──────────────────────────────────────

// Standard FBM: layer octaves of noise with increasing frequency and
// decreasing amplitude. The lacunarity (2.0) and gain (0.5) are the
// classic values — produces self-similar detail at all scales.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.0;       // lacunarity: each octave is 2× the frequency
    a *= 0.5;      // gain: each octave is half the amplitude
  }
  return v;
}

// 3D FBM for time-varying fields. Pass (uv, time * speed) to animate.
float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise3(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// Billowed FBM: take abs() of noise to create ridge-like features.
// Produces "cracked earth" or "veins" aesthetics instead of clouds.
float fbillowed(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * abs(vnoise(p) * 2.0 - 1.0);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// Ridge FBM: 1 - abs() to get sharp ridges. Multiply by gain for contrast.
float fridge(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0));
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// ─── Domain warp (warp the coordinate space with noise) ─────────────────

// Simple domain warp: shift the input coordinate by a noise field.
// Creates flowing, organic distortion — the "marble" or "wood grain" look.
vec2 warp(vec2 p, float t) {
  return p + vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, t + 1.3)));
}

// Iterated domain warp: warp the warp. Deeper, more chaotic distortion.
// Inigo Quilez's "warp" article recipe.
vec2 warp2(vec2 p, float t) {
  vec2 q = vec2(fbm(p + vec2(0.0, 0.0)), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t),
                fbm(p + 4.0 * q + vec2(8.3, 2.8) + t));
  return r;
}

// ─── Cosine palette (Iñigo Quilez) ──────────────────────────────────────

// Cosine palette: color(t) = a + b * cos(2π * (c*t + d))
// The four vec3 parameters a/b/c/d define the entire color curve.
// Period is 1/c — higher c = more oscillations.
// Phase d shifts the hue curve.
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

// ─── Polar coordinates ──────────────────────────────────────────────────

// Convert cartesian to polar. Useful for radial patterns, mandalas,
// kaleidoscopes. Returns (angle, radius).
vec2 toPolar(vec2 p) {
  return vec2(atan(p.y, p.x), length(p));
}

// Convert polar back to cartesian. Use after toPolar() to apply
// per-angle/per-radius operations.
vec2 fromPolar(vec2 polar) {
  return polar.y * vec2(cos(polar.x), sin(polar.x));
}

// ─── 2D rotation ────────────────────────────────────────────────────────

// Rotate a 2D point around the origin by angle a (radians).
vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

// ─── Easing functions ───────────────────────────────────────────────────

// smoothstep is C1 continuous. Use for most transitions.
// smootherstep is C2 continuous — smoother but more expensive.
float smootherstep(float edge0, float edge1, float x) {
  x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

// Cubic ease-in-out: classic "ease in then ease out".
float easeInOut(float x) {
  return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
}
`;
