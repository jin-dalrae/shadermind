/**
 * Curated GLSL logic blocks — building blocks for generation, not full shaders.
 * Each pattern has detect regexes so feedback can score what actually compiled.
 * LearnOpenGL-derived patterns cite https://learnopengl.com (Joey de Vries).
 */

export const SHADER_PATTERNS = [
  {
    id: "aspect-uv",
    name: "Aspect-correct UV",
    category: "coords",
    tags: ["uv", "aspect", "centered"],
    shapes: ["field", "grid"],
    description: "Centered UV with uniform scale across aspect ratios.",
    snippet: `vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);`,
    detect: [/gl_FragCoord\.xy\s*-\s*0\.5\s*\*\s*u_resolution/i, /min\s*\(\s*u_resolution\.(x|y)/i]
  },
  {
    id: "polar-field",
    name: "Polar field",
    category: "coords",
    tags: ["polar", "atan", "radial"],
    shapes: ["rings", "spokes", "spiral"],
    description: "Radius + angle drive ripples, spokes, or spirals.",
    snippet: `float r = length(uv);
float a = atan(uv.y, uv.x);
float field = sin(r * 8.0 - u_time * 0.5 + a * 3.0);`,
    detect: [/atan\s*\(\s*uv\.y\s*,\s*uv\.x\s*\)/i, /atan\s*\(\s*\w+\.y\s*,\s*\w+\.x\s*\)/i]
  },
  {
    id: "hash-noise",
    name: "Hash value noise",
    category: "noise",
    tags: ["hash", "noise", "grain"],
    shapes: ["grain", "speckle", "texture"],
    description: "Cheap procedural grain without permute/snoise.",
    snippet: `float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float n = mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x);`,
    detect: [/fract\s*\(\s*sin\s*\(\s*dot/i, /\bhash\s*\(/i]
  },
  {
    id: "fbm-layers",
    name: "FBM layers",
    category: "noise",
    tags: ["fbm", "noise", "cloud"],
    shapes: ["cloud", "marble", "terrain"],
    description: "3–4 octave fractal noise for organic structure.",
    snippet: `float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (float i = 0.0; i < 4.0; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}`,
    detect: [/\bfbm\s*\(/i, /for\s*\(\s*float\s+\w+\s*=\s*0\.0;\s*\w+\s*<\s*4\.0/i]
  },
  {
    id: "damped-ripples",
    name: "Damped radial ripples",
    category: "motion",
    tags: ["ripple", "sin", "radial", "wave"],
    shapes: ["rings", "waves", "pond"],
    description: "Concentric waves that fade toward the edges.",
    snippet: `float wave = sin(r * 10.0 - u_time * 0.8) * 0.5 + 0.5;
float damp = exp(-r * 1.5);
float pattern = wave * damp;`,
    detect: [/sin\s*\(\s*r\s*\*.*-\s*u_time/i, /exp\s*\(\s*-r/i]
  },
  {
    id: "cosine-palette",
    name: "Cosine palette",
    category: "color",
    tags: ["cosine", "palette", "hue"],
    shapes: ["gradient", "spectrum", "band"],
    description: "Inigo Quilez cosine palette for rich color without textures.",
    snippet: `vec3 pal(float t) {
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(0.0, 0.33, 0.67) * t + vec3(0.0, 0.1, 0.2)));
}
vec3 col = pal(field + u_time * 0.05);`,
    detect: [/cos\s*\(\s*6\.28/i, /vec3\s*\(\s*0\.5\s*\)\s*\+\s*vec3\s*\(\s*0\.5\s*\)\s*\*\s*cos/i]
  },
  {
    id: "domain-warp",
    name: "Domain warp",
    category: "warp",
    tags: ["warp", "distort", "noise"],
    shapes: ["liquid", "smoke", "marble"],
    description: "Offset UV by noise before sampling the field.",
    snippet: `vec2 warp = vec2(
  noise(uv * 2.0 + u_time * 0.1),
  noise(uv * 2.0 - u_time * 0.08)
);
float field = noise(uv * 3.0 + warp * 0.6);`,
    detect: [/warp|distort/i, /noise\s*\(\s*uv\s*\*.*\+\s*\w+/i]
  },
  {
    id: "kaleidoscope",
    name: "Kaleidoscope fold",
    category: "structure",
    tags: ["kaleidoscope", "symmetry", "polar"],
    shapes: ["mandala", "star", "tile"],
    description: "Angular repetition for symmetric motifs.",
    snippet: `float a = atan(uv.y, uv.x);
float slices = 6.0;
a = abs(mod(a, 6.28318 / slices) - 3.14159 / slices);
vec2 k = vec2(cos(a), sin(a)) * length(uv);`,
    detect: [/mod\s*\(\s*a\s*,/i, /kaleidoscope/i, /abs\s*\(\s*mod\s*\(\s*a/i]
  },
  {
    id: "flow-distort",
    name: "Flow distortion",
    category: "warp",
    tags: ["flow", "swirl", "vector"],
    shapes: ["stream", "vortex", "current"],
    description: "Rotate UV by a flow angle from noise or radius.",
    snippet: `float angle = noise(uv * 1.5) * 6.28 + r * 2.0;
float cs = cos(angle), sn = sin(angle);
vec2 flow = vec2(uv.x * cs - uv.y * sn, uv.x * sn + uv.y * cs);`,
    detect: [/cos\s*\(\s*angle\s*\).*-.*uv\.y\s*\*\s*sin/i, /\bflow\b/i]
  },
  {
    id: "voronoi-cells",
    name: "Voronoi cells",
    category: "structure",
    tags: ["voronoi", "cell", "edge"],
    shapes: ["honeycomb", "crack", "mosaic"],
    description: "Cell edges from distance-to-random-points.",
    snippet: `vec2 i = floor(uv * 5.0);
vec2 f = fract(uv * 5.0);
float d = 1.0;
for (float y = -1.0; y <= 1.0; y++) {
  for (float x = -1.0; x <= 1.0; x++) {
    vec2 g = vec2(x, y);
    vec2 o = vec2(hash(i + g), hash(i + g + 17.0));
    d = min(d, length(g + o - f));
  }
}`,
    detect: [/voronoi/i, /floor\s*\(\s*uv\s*\*/i, /min\s*\(\s*d\s*,\s*length/i]
  },
  {
    id: "interference-stripes",
    name: "Interference stripes",
    category: "motion",
    tags: ["stripe", "moire", "interference"],
    shapes: ["lines", "bands", "moire"],
    description: "Multiply angled sine waves for moiré and scan lines.",
    snippet: `float s1 = sin(uv.x * 30.0 + u_time * 0.4);
float s2 = sin(uv.y * 25.0 - u_time * 0.3);
float pattern = s1 * s2 * 0.5 + 0.5;`,
    detect: [/sin\s*\(\s*uv\.x.*\*\s*\d+.*sin\s*\(\s*uv\.y/i, /sin\s*\(\s*uv\.\w\s*\*.*\)\s*\*\s*sin/i]
  },
  {
    id: "mouse-wake",
    name: "Mouse wake",
    category: "motion",
    tags: ["mouse", "interactive", "glow"],
    shapes: ["wake", "glow", "trail"],
    description: "Phase shift or bulge near cursor.",
    snippet: `vec2 m = (u_mouse - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
float wake = exp(-length(uv - m) * 4.0);
float field = sin(r * 6.0 - u_time + wake * 2.0);`,
    detect: [/u_mouse/i]
  },
  {
    id: "soft-vignette",
    name: "Soft vignette",
    category: "color",
    tags: ["vignette", "fade", "radial"],
    shapes: ["frame", "spotlight"],
    description: "Darken edges so the center reads clearly.",
    snippet: `float vig = 1.0 - smoothstep(0.4, 1.2, length(uv));
col *= vig;`,
    detect: [/smoothstep\s*\([^)]*length\s*\(\s*uv/i, /\bvig(nette)?\b/i]
  },
  {
    id: "twist-warp",
    name: "Twist warp",
    category: "warp",
    tags: ["twist", "spiral", "rotate"],
    shapes: ["spiral", "pinwheel", "whirl"],
    description: "Angle offset proportional to radius.",
    snippet: `float twist = r * 3.0 + u_time * 0.2;
float cs = cos(twist), sn = sin(twist);
vec2 tuv = vec2(uv.x * cs - uv.y * sn, uv.x * sn + uv.y * cs);`,
    detect: [/twist/i, /r\s*\*\s*3\.0\s*\+\s*u_time/i]
  },
  {
    id: "lo-color-multiply",
    name: "LearnOpenGL color multiply",
    category: "color",
    tags: ["color", "light", "multiply"],
    shapes: ["tint", "wash", "material"],
    description: "Perceived color = lightColor * surfaceColor (LearnOpenGL Colors).",
    source: "https://learnopengl.com/Lighting/Colors",
    snippet: `vec3 lightColor = vec3(1.0, 0.95, 0.85);
vec3 surfaceColor = vec3(0.9, 0.45, 0.2);
vec3 col = lightColor * surfaceColor;`,
    detect: [/lightColor\s*\*\s*\w+/i, /vec3\s+col\s*=\s*\w+Color\s*\*/i]
  },
  {
    id: "lo-height-normal",
    name: "Height-field normal",
    category: "lighting",
    tags: ["normal", "height", "bump"],
    shapes: ["terrain", "relief", "emboss"],
    description: "Finite-difference normal from a height field (Basic Lighting prep).",
    source: "https://learnopengl.com/Lighting/Basic-Lighting",
    snippet: `float h = fbm(uv * 2.0 + u_time * 0.05);
float dx = h - fbm(uv * 2.0 + vec2(0.003, 0.0) + u_time * 0.05);
float dy = h - fbm(uv * 2.0 + vec2(0.0, 0.003) + u_time * 0.05);
vec3 n = normalize(vec3(-dx, -dy, 0.05));`,
    detect: [/normalize\s*\(\s*vec3\s*\(\s*-\s*\w+,\s*-\s*\w+/i, /float\s+dx\s*=\s*h\s*-/i]
  },
  {
    id: "lo-lambert-diffuse",
    name: "Lambert diffuse",
    category: "lighting",
    tags: ["diffuse", "lambert", "phong"],
    shapes: ["shaded", "relief", "lit"],
    description: "Diffuse = max(dot(normal, lightDir), 0) * lightColor (Basic Lighting).",
    source: "https://learnopengl.com/Lighting/Basic-Lighting",
    snippet: `vec3 lightDir = normalize(vec3(0.4, 0.5, 0.75));
float diff = max(dot(n, lightDir), 0.0);
vec3 diffuse = diff * lightColor * surfaceColor;`,
    detect: [/max\s*\(\s*dot\s*\(\s*n\s*,/i, /float\s+diff\s*=\s*max\s*\(\s*dot/i]
  },
  {
    id: "lo-blinn-specular",
    name: "Blinn specular",
    category: "lighting",
    tags: ["specular", "blinn", "highlight"],
    shapes: ["gloss", "highlight", "wet"],
    description: "Specular highlight via half-vector (Basic Lighting specular).",
    source: "https://learnopengl.com/Lighting/Basic-Lighting",
    snippet: `vec3 viewDir = vec3(0.0, 0.0, 1.0);
vec3 halfDir = normalize(lightDir + viewDir);
float spec = pow(max(dot(n, halfDir), 0.0), 48.0);
vec3 specular = spec * lightColor * 0.4;`,
    detect: [/halfDir/i, /pow\s*\(\s*max\s*\(\s*dot\s*\(\s*n\s*,\s*halfDir/i]
  },
  {
    id: "lo-gamma-correct",
    name: "Gamma correction",
    category: "color",
    tags: ["gamma", "srgb", "linear"],
    shapes: ["balanced", "natural", "graded"],
    description: "Apply pow(rgb, 1/2.2) once at the end (Gamma Correction chapter).",
    source: "https://learnopengl.com/Advanced-Lighting/Gamma-Correction",
    snippet: `vec3 lit = ambient + diffuse + specular;
lit = pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2));
gl_FragColor = vec4(lit, 1.0);`,
    detect: [/pow\s*\([^)]*vec3\s*\(\s*1\.0\s*\/\s*2\.2\s*\)/i, /pow\s*\(\s*max\s*\(\s*lit/i]
  },
  {
    id: "lo-mouse-light",
    name: "Mouse point light",
    category: "lighting",
    tags: ["mouse", "point", "attenuation"],
    shapes: ["spot", "torch", "interactive"],
    description: "Point light at u_mouse with inverse-square attenuation in linear space.",
    source: "https://learnopengl.com/Lighting/Basic-Lighting",
    snippet: `vec2 lightUV = (u_mouse - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
float dist = length(uv - lightUV);
vec3 lDir = normalize(vec3(lightUV - uv, 0.35));
float att = 1.0 / (1.0 + 20.0 * dist * dist);
float diff = max(dot(n, lDir), 0.0) * att;`,
    detect: [/u_mouse.*lightUV|lightUV.*u_mouse/i, /1\.0\s*\/\s*\(\s*1\.0\s*\+.*dist\s*\*\s*dist/i]
  }
];

const PATTERN_MAP = new Map(SHADER_PATTERNS.map(p => [p.id, p]));

export function getPatternById(id) {
  return PATTERN_MAP.get(id) || null;
}

export function getAllPatterns() {
  return SHADER_PATTERNS;
}