/**
 * LearnOpenGL concepts adapted for ShaderMind's WebGL 1.0 fragment-only shaders.
 * Source: https://learnopengl.com/Introduction (Joey de Vries, CC BY-NC 4.0)
 *
 * We use the curriculum's math and lighting ideas — not 3D vertex pipelines.
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

export const LEARNOPENGL_CURRICULUM_COMPACT = `
LearnOpenGL curriculum (fragment-relevant chapters):
1. Shaders — uniforms drive u_time; all work in main(); no vertex stage
2. Colors — perceived color = lightColor * surfaceColor
3. Basic Lighting — ambient + diffuse (dot normal, lightDir) + specular highlight
4. Gamma — linear lighting math, then pow(rgb, 1/2.2) once before gl_FragColor
5. Coordinates — aspect-correct uv, polar (r, atan), fract tiling
Prefer full-frame fields (noise, FBM, ripples) over isolated circle masks.
`.trim();

export const LEARNOPENGL_CHAPTERS = [
  { id: "shaders", title: "Shaders", url: `${LEARNOPENGL_SOURCE}/Getting-started/Shaders`, topics: ["uniforms", "glsl", "vec"] },
  { id: "colors", title: "Colors", url: `${LEARNOPENGL_SOURCE}/Lighting/Colors`, topics: ["multiply", "reflection", "palette"] },
  { id: "basic-lighting", title: "Basic Lighting", url: `${LEARNOPENGL_SOURCE}/Lighting/Basic-Lighting`, topics: ["ambient", "diffuse", "specular", "phong"] },
  { id: "gamma", title: "Gamma Correction", url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Gamma-Correction`, topics: ["gamma", "linear", "srgb"] },
  { id: "transformations", title: "Transformations", url: `${LEARNOPENGL_SOURCE}/Getting-started/Transformations`, topics: ["rotate", "scale", "uv"] },
  { id: "coordinate-systems", title: "Coordinate Systems", url: `${LEARNOPENGL_SOURCE}/Getting-started/Coordinate-Systems`, topics: ["clip", "ndc", "aspect"] }
];