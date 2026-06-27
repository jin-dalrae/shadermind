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

  if (!code.includes("precision")) {
    code = `precision mediump float;\n${code}`;
  }

  if (!code.includes("gl_FragColor") && code.includes("void main")) {
    return "";
  }

  return code.trim();
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
  if (isFallbackGlsl(code)) {
    return { valid: false, reason: "Matches fallback placeholder." };
  }

  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    return { valid: false, reason: "Unbalanced braces." };
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