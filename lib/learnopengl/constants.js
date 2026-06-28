/**
 * LearnOpenGL concepts adapted for ShaderMind's WebGL 1.0 fragment-only shaders.
 * Source: https://learnopengl.com (Joey de Vries, CC BY-NC 4.0)
 */

export const LEARNOPENGL_SOURCE = "https://learnopengl.com";

/** Compact rules from Getting-started/Shaders, adapted to ES 1.0 + gl_FragColor. */
export const LEARNOPENGL_GLSL_RULES = `
LearnOpenGL GLSL discipline (WebGL 1.0 fragment adaptation):
- Start with: precision mediump float;
- Entry: void main() { ... gl_FragColor = vec4(rgb, 1.0); }
- Globals from host: uniform float u_time; uniform vec2 u_resolution; uniform vec2 u_mouse;
- Use vec2/vec3/vec4, swizzle with .x .y .z .w only (no .u/.v — invalid in WebGL 1.0 here)
- Normalize direction vectors before dot products (lighting, specular)
- Keep helpers small; define every function you call
`.trim();

/**
 * Fragment-shader lighting & color (Lighting/Colors, Basic-Lighting, Gamma-Correction).
 * Fake 3D in 2D: height field → finite-diff normal → Phong-ish terms.
 */
export const LEARNOPENGL_LIGHTING_COOKBOOK = `
LearnOpenGL lighting (2D fragment fake-3D):
- Color reflection: vec3 col = lightColor * surfaceColor; (component-wise, Colors chapter)
- Ambient base: vec3 ambient = 0.08 * surfaceColor;
- Height h = noise(uv) or fbm(uv); normal from finite differences:
  float dx = h - noise(uv + vec2(0.002, 0.0));
  float dy = h - noise(uv + vec2(0.0, 0.002));
  vec3 n = normalize(vec3(-dx, -dy, 0.04));
- Diffuse (Lambert): float diff = max(dot(n, normalize(lightDir)), 0.0);
- Specular (Blinn): vec3 v = vec3(0.0, 0.0, 1.0); vec3 h = normalize(lightDir + v);
  float spec = pow(max(dot(n, h), 0.0), 32.0) * 0.35;
- Point light at u_mouse (screen uv): vec3 lightDir = normalize(vec3(u_mouse - uv, 0.35));
- Attenuation in linear space: float att = 1.0 / (1.0 + 25.0 * dist * dist);
- Combine: vec3 lit = ambient + (diff + spec) * att * lightColor * surfaceColor;
- Gamma correction LAST (Gamma-Correction): col = pow(max(lit, 0.0), vec3(1.0/2.2));
`.trim();