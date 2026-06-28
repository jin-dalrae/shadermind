import { patchGlslForWebGL } from "../public/glsl-patch.js";

const PLACEHOLDER_SIGNATURES = [
  "vec3(0.9, 0.5, 0.2) * (0.4 + 0.6 * wave)",
  "mix(vec3(0.05, 0.1, 0.15), vec3(0.2, 0.7, 0.8), ripple)",
  "vec3(0.15, 0.35, 0.55) * ripple + vec3(0.05)"
];

/** Built-in placeholder shaders — never show in gallery. */
export function isPlaceholderGlsl(glsl) {
  const code = stripGlslFences(glsl);
  return PLACEHOLDER_SIGNATURES.some((sig) => code.includes(sig));
}

export function stripGlslFences(text) {
  if (typeof text !== "string") return "";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:glsl)?\s*/i, "").replace(/\s*```$/m, "");
  }
  return cleaned.replace(/\\n/g, "\n").trim();
}

export function decodeGlslField(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  let cleaned = stripGlslFences(trimmed);

  if (cleaned.includes("gl_FragColor") || cleaned.startsWith("precision")) {
    return sanitizeGlsl(cleaned);
  }

  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 40) {
    try {
      const decoded = Buffer.from(trimmed.replace(/\s/g, ""), "base64").toString("utf8");
      if (decoded.includes("precision") || decoded.includes("gl_FragColor")) {
        return sanitizeGlsl(decoded);
      }
    } catch {
      // fall through
    }
  }

  return sanitizeGlsl(value.replace(/\\n/g, "\n"));
}

export function sanitizeGlsl(glsl) {
  if (!glsl || typeof glsl !== "string") return "";

  let code = stripGlslFences(glsl);

  // ES 3.0 → ES 1.0 common fixes
  code = code.replace(/\bout\s+vec4\s+FragColor\s*;/g, "");
  code = code.replace(/\bFragColor\s*=/g, "gl_FragColor =");
  code = code.replace(/\bin\s+vec2\s+TexCoord\s*;/g, "");
  code = code.replace(/\btexture\s*\(/g, "texture2D(");

  if (!/\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(code)) {
    if (/\bprecision\s+\w+\s+float\s*;/.test(code)) {
      code = code.replace(/\bprecision\s+\w+\s+float\s*;/g, "precision mediump float;");
    } else {
      code = `precision mediump float;\n${code}`;
    }
  }

  if (!code.includes("gl_FragColor") && code.includes("void main")) {
    return "";
  }

  code = patchGlslForWebGL(code);

  return code.trim();
}

const HELPER_FUNCS = ["permute", "mod289", "snoise", "hash", "random", "rotate2d", "hsv2rgb"];

function stripGlslComments(code) {
  return code
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

export function findUndefinedCalls(glsl) {
  const code = stripGlslComments(sanitizeGlsl(glsl));
  const defined = new Set(
    [...code.matchAll(/\b(float|vec[234]|int|void|mat[234])\s+(\w+)\s*\(/g)].map(m => m[2])
  );
  defined.add("main");

  const called = new Set([...code.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)].map(m => m[1]));
  const builtins = new Set([
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "pow", "exp", "log", "sqrt", "abs",
    "floor", "ceil", "fract", "mod", "min", "max", "clamp", "mix", "smoothstep", "step",
    "length", "distance", "dot", "cross", "normalize", "reflect", "refract", "faceforward",
    "vec2", "vec3", "vec4", "mat2", "mat3", "mat4", "float", "int", "bool", "texture2D",
    "if", "for", "while", "return", "break", "continue", "discard", "exp", "sign"
  ]);

  const missing = [];
  for (const name of called) {
    if (builtins.has(name) || defined.has(name)) continue;
    if (/^[A-Z]/.test(name)) continue;
    missing.push(name);
  }
  return [...new Set(missing)].filter(n => !n.match(/^(main|gl_FragColor)$/));
}

export function validateGlsl(glsl) {
  const code = sanitizeGlsl(glsl);
  if (!code || code.length < 80) {
    return { valid: false, reason: "Shader too short or empty." };
  }
  if (!code.includes("void main")) {
    return { valid: false, reason: "Missing void main()." };
  }
  if (!code.includes("gl_FragColor")) {
    return { valid: false, reason: "Missing gl_FragColor assignment." };
  }
  if (/\bout\s+vec4\b/.test(code)) {
    return { valid: false, reason: "GLSL ES 3.0 syntax detected (out vec4)." };
  }
  if (/\.[uv]\b/.test(code)) {
    return { valid: false, reason: "Invalid swizzle (.u/.v not valid in WebGL 1.0)." };
  }
  if (isPlaceholderGlsl(code)) {
    return { valid: false, reason: "Matches placeholder shader." };
  }
  if (/\bprecision\s+\w+\s+float\s*;/.test(code) && !/\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(code)) {
    return { valid: false, reason: "Invalid precision qualifier (e.g. mediour → mediump)." };
  }

  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    return { valid: false, reason: "Unbalanced braces." };
  }

  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    return { valid: false, reason: "Unbalanced parentheses." };
  }

  const undefinedCalls = findUndefinedCalls(code);
  if (undefinedCalls.length) {
    return { valid: false, reason: `Undefined functions: ${undefinedCalls.join(", ")}` };
  }

  if (isLowEffortGlsl(code)) {
    return { valid: false, reason: "Low-effort output (plain pulsing circle on black)." };
  }

  return { valid: true, code };
}

export function isFallbackGlsl(glsl) {
  return isPlaceholderGlsl(glsl);
}

function hasFullFrameTechnique(code) {
  return /fract\s*\(\s*uv|fract\s*\([^)]*\.[xy]/.test(code)
    || /fbm|noise|snoise|voronoi|kaleidoscope|domain\s*warp|hash\s*\(/.test(code)
    || /atan\s*\(\s*\w+\.y\s*,\s*\w+\.x\s*\)/.test(code)
    || /sin\s*\(\s*uv|sin\s*\(\s*\w+\.x\s*[\*+]|sin\s*\(\s*dist\s*\*/.test(code)
    || /cos\s*\(\s*uv|cos\s*\(\s*\w+\.y\s*[\*+]/.test(code)
    || /for\s*\(\s*float\s+\w+\s*=/.test(code);
}

export function isLowEffortGlsl(glsl) {
  const code = stripGlslComments(sanitizeGlsl(glsl)).toLowerCase();
  if (!code) return false;

  const circleMask = /smoothstep\s*\(\s*\w+\s*,\s*\w+\s*-\s*[\d.]+\s*,\s*dist\)/.test(code)
    || /smoothstep\s*\(\s*size/.test(code)
    || /1\.0\s*-\s*smoothstep\s*\([^)]*length\s*\(/.test(code);

  const radialDist = /length\s*\(\s*(uv|rotated_uv|rot_uv|p|st|coord|\w+_uv)/.test(code);
  const radialBlob = circleMask && radialDist;

  const maskedOnBlack = /gl_fragcolor\s*=\s*vec4\s*\([^)]*\*\s*mask/.test(code)
    || /gl_fragcolor\s*=\s*vec4\s*\(\s*\w+\s*\*\s*mask/.test(code);

  const pulseOnly = /sin\s*\(\s*(t|u_time)/.test(code) && radialBlob;

  const hardBlobOnBlack = /vec3\s*\(\s*0(?:\.0)?/.test(code)
    && /if\s*\(\s*\w+\s*<\s*1\.0\s*\)/.test(code)
    && radialDist;

  const ringOnly = /smoothstep[^;]*dist[^;]*-\s*smoothstep/.test(code)
    && !hasFullFrameTechnique(code);

  const timeFractBlob = /fract\s*\(\s*(t|u_time)/.test(code)
    && radialDist
    && !hasFullFrameTechnique(code);

  if (radialBlob && !hasFullFrameTechnique(code)) return true;
  if (maskedOnBlack && radialBlob && !hasFullFrameTechnique(code)) return true;
  if (pulseOnly && !hasFullFrameTechnique(code)) return true;
  if (hardBlobOnBlack && !hasFullFrameTechnique(code)) return true;
  if (ringOnly) return true;
  if (timeFractBlob) return true;

  const lineCount = code.split("\n").filter(l => l.trim() && !l.trim().startsWith("//")).length;
  if (radialBlob && lineCount < 42 && !hasFullFrameTechnique(code)) return true;

  return false;
}

export function truncateGlsl(glsl, maxLines = 80) {
  const lines = glsl.split("\n");
  if (lines.length <= maxLines) return glsl;
  return lines.slice(0, maxLines).join("\n") + "\n// ... truncated ...";
}