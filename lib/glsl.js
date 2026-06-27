import { patchGlslForWebGL } from "../public/glsl-patch.js";

const FALLBACK_SIGNATURES = [
  "vec3(0.9, 0.5, 0.2) * (0.4 + 0.6 * wave)",
  "mix(vec3(0.05, 0.1, 0.15), vec3(0.2, 0.7, 0.8), ripple)"
];

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
  if (isFallbackGlsl(code)) {
    return { valid: false, reason: "Matches fallback placeholder." };
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

  return { valid: true, code };
}

export function isFallbackGlsl(glsl) {
  const code = stripGlslFences(glsl);
  return FALLBACK_SIGNATURES.some(sig => code.includes(sig));
}

export function truncateGlsl(glsl, maxLines = 80) {
  const lines = glsl.split("\n");
  if (lines.length <= maxLines) return glsl;
  return lines.slice(0, maxLines).join("\n") + "\n// ... truncated ...";
}