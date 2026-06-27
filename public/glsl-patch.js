/**
 * Runtime GLSL patches for WebGL 1.0 — fixes common AI-generated noise helper mistakes.
 */

function stripComments(code) {
  return code
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasPermuteCalls(code) {
  return /\bpermute\s*\(/.test(stripComments(code));
}

function hasGoodPermuteDef(code) {
  const stripped = stripComments(code);
  return /\bvec[234]\s+permute\s*\([^)]*\)\s*\{[^}]*mod289/.test(stripped);
}

function hasBrokenPermuteDef(code) {
  const stripped = stripComments(code);
  return /\bvec[234]\s+permute\s*\([^)]*\)\s*\{[^}]*\bmod\s*\(/.test(stripped);
}

function removeBrokenPermuteDefs(code) {
  return code.replace(
    /\bvec[234]\s+permute\s*\(\s*vec[234]\s+\w+\s*\)\s*\{[^}]*\}/g,
    ""
  );
}

function collectNeededHelpers(code) {
  const stripped = stripComments(code);
  const lines = [];
  const usesMod289 = /\bmod289\s*\(/.test(stripped);
  const hasMod289v2 = /\bvec2\s+mod289\s*\(/.test(stripped);
  const hasMod289v3 = /\bvec3\s+mod289\s*\(/.test(stripped);
  const hasMod289v4 = /\bvec4\s+mod289\s*\(/.test(stripped);
  const callsPermute = /\bpermute\s*\(/.test(stripped);
  const needsVec4Permute =
    /\bvec4\s+permute\s*\(/.test(stripped) ||
    /\bpermute\s*\(\s*permute\s*\([^)]*vec4/.test(stripped);

  if (usesMod289 && !hasMod289v2) {
    lines.push("vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }");
  }
  if ((usesMod289 || callsPermute) && !hasMod289v3) {
    lines.push("vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }");
  }
  if ((usesMod289 || needsVec4Permute) && !hasMod289v4) {
    lines.push("vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }");
  }
  if (callsPermute && !hasGoodPermuteDef(code)) {
    if (needsVec4Permute) {
      lines.push("vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }");
    }
    if (!needsVec4Permute || !/\bvec3\s+permute\s*\(/.test(stripped)) {
      lines.push("vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }");
    }
  }

  return lines;
}

function injectAfterHeader(code, block) {
  if (!block.trim()) return code;
  const headerMatch = code.match(
    /^((?:\s*precision\s+[^;]+;[\s\n]*)?(?:\s*uniform\s+[^;]+;[\s\n]*)*(?:\s*#define\s+[^\n]+[\s\n]*)*)/
  );
  if (headerMatch) {
    return `${headerMatch[1]}\n${block}\n${code.slice(headerMatch[0].length)}`;
  }
  return `${block}\n${code}`;
}

function fixPrecisionDeclaration(code) {
  if (/\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(code)) {
    return code;
  }
  let patched = code.replace(
    /\bprecision\s+\w+\s+float\s*;/g,
    "precision mediump float;"
  );
  if (!/\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(patched)) {
    patched = `precision mediump float;\n${patched}`;
  }
  return patched;
}

function fixIntLoops(code) {
  return code
    .replace(
      /for\s*\(\s*int\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\d+)\s*;\s*\+\+\s*\1\s*\)/g,
      "for (float $1 = 0.0; $1 < $2.0; $1 += 1.0)"
    )
    .replace(
      /for\s*\(\s*int\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\w+)\s*;\s*\+\+\s*\1\s*\)/g,
      "for (float $1 = 0.0; $1 < float($2); $1 += 1.0)"
    );
}

function fixInvalidSwizzles(code) {
  let patched = code.replace(/\.u\b/g, ".x").replace(/\.v\b/g, ".y");

  const vec3PermuteP =
    /vec3\s+p\s*=\s*permute/.test(patched) && !/vec4\s+p\s*=/.test(patched);
  if (vec3PermuteP) {
    patched = patched.replace(/\bp\.w\b/g, "p.x");
  }

  return patched;
}

export function patchGlslForWebGL(code) {
  if (!code || typeof code !== "string") return "";

  let patched = fixPrecisionDeclaration(fixIntLoops(fixInvalidSwizzles(code)));

  if (hasBrokenPermuteDef(patched)) {
    patched = removeBrokenPermuteDefs(patched);
  }

  if (hasPermuteCalls(patched) && !hasGoodPermuteDef(patched)) {
    const helpers = collectNeededHelpers(patched);
    if (helpers.length) {
      patched = injectAfterHeader(patched, helpers.join("\n"));
    }
  } else {
    const helpers = collectNeededHelpers(patched).filter((line) =>
      line.startsWith("mod289")
    );
    if (helpers.length) {
      patched = injectAfterHeader(patched, helpers.join("\n"));
    }
  }

  return patched;
}