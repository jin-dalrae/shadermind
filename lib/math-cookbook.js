import {
  LEARNOPENGL_CURRICULUM_COMPACT,
  LEARNOPENGL_GLSL_RULES,
  LEARNOPENGL_LIGHTING_COOKBOOK
} from "./learnopengl.js";
import {
  SHADER_TUTORIAL_MATH_COMPACT,
  SHADER_TUTORIAL_FRAGMENT_COMPACT
} from "./shader-tutorial.js";

export const MATH_COOKBOOK = `
MATH COOKBOOK (WebGL 1.0 fragment — pick 1–2 concepts per shader, keep code short):

Coordinates & warps:
- Aspect UV: vec2 uv = (gl_FragCoord.xy - 0.5*u_resolution) / min(u_resolution.y, u_resolution.x);
- Polar: float r = length(uv), a = atan(uv.y, uv.x);
- Domain repeat: uv = fract(uv * N) - 0.5;
- Kaleidoscope: a = mod(a, 6.283/N); uv = vec2(cos(a), sin(a)) * r;

Cheap noise (prefer these — fast, compile-safe):
- Hash: fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
- Value noise: hash on floor(p) + smooth mix on fract(p);
- FBM: 3–4 octaves, amplitude *= 0.5, frequency *= 2.0, use float loops only.

Motion:
- Slow/fast pulse: sin(u_time*0.15) * sin(u_time*1.1);
- Damped wave: exp(-r*2.0) * sin(r*8.0 - u_time*0.6);
- Mouse phase: uv -= (u_mouse - 0.5) * 0.2;

Fake 3D (no raymarch):
- Height h = noise(uv); finite-diff normal from h at uv±0.002;
- Lambert: max(dot(n, normalize(vec3(0.5,0.6,0.7))), 0.0);
- Hyperbolic warp: uv *= 1.0/(1.0 + r*0.5);

Color:
- Cosine palette: a + b*cos(6.283*(c*t + d));
- Pastel: low saturation 0.2–0.4, slow hue shift;
- Vignette: col *= 1.0 - smoothstep(0.3, 1.0, r);
- Gamma: pow(col, vec3(0.45));

AVOID: permute/snoise without Ashima mod289 helpers; int loops; .u/.v swizzles; raymarching; shaders >60 lines.

${LEARNOPENGL_GLSL_RULES}

${LEARNOPENGL_LIGHTING_COOKBOOK}

${SHADER_TUTORIAL_MATH_COMPACT}

${SHADER_TUTORIAL_FRAGMENT_COMPACT}
`.trim();

export const MATH_COOKBOOK_COMPACT =
  `${LEARNOPENGL_CURRICULUM_COMPACT} ${SHADER_TUTORIAL_MATH_COMPACT} Pick 1–2 shapes: polar UV, FBM, damped ripples, Lambert diffuse, gamma output. Under 55 lines.`;