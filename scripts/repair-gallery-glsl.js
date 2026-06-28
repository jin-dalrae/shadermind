/**
 * Repair stored GLSL for broken gallery sketches, verify in headless WebGL, persist to Mongo.
 * Usage: node scripts/repair-gallery-glsl.js
 */
import "dotenv/config";
import { chromium } from "playwright";
import { MongoClient } from "mongodb";
import { decodeGlslField } from "../lib/glsl.js";
import { patchGlslForWebGL } from "../public/glsl-patch.js";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FALLBACK = `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  float ripple = sin(length(p) * 10.0 - u_time * 0.6) * 0.5 + 0.5;
  gl_FragColor = vec4(vec3(0.15, 0.35, 0.55) * ripple + vec3(0.05), 1.0);
}`;

function repairGlsl(raw) {
  return decodeGlslField(raw);
}

async function compileCheck(page, source) {
  return page.evaluate((glsl) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const gl = canvas.getContext("webgl");
    if (!gl) return { ok: false, log: "WebGL unavailable" };
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, glsl);
    gl.compileShader(fs);
    const ok = gl.getShaderParameter(fs, gl.COMPILE_STATUS);
    return { ok, log: gl.getShaderInfoLog(fs) || "" };
  }, source);
}

async function main() {
  const base = process.env.REPAIR_BASE_URL || "http://localhost:8080";

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI required");
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || "shadermind").collection("sketches");
  const sketches = await col.find({}).toArray();

  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage();

  let updated = 0;
  let fallbacks = 0;

  for (const sketch of sketches) {
    if (typeof sketch.glsl !== "string") continue;

    const patched = repairGlsl(sketch.glsl);
    let check = await compileCheck(page, patched);
    let finalGlsl = patched;

    if (!check.ok) {
      console.log(
        `${sketch.id}: ${(check.log || "compile failed").replace(/\s+/g, " ").slice(0, 140)}`
      );
      finalGlsl = FALLBACK;
      check = await compileCheck(page, finalGlsl);
      if (!check.ok) {
        console.log(`${sketch.id}: fallback also failed — skip`);
        continue;
      }
      fallbacks += 1;
    }

    if (
      check.ok
      && finalGlsl === sketch.glsl
      && sketch.thumbnail
      && (sketch.thumbnailVersion || 0) >= 3
    ) {
      continue;
    }

    const glslChanged = finalGlsl !== sketch.glsl;
    const needsThumb = !sketch.thumbnail || (sketch.thumbnailVersion || 0) < 3;

    const $set = {
      glsl: finalGlsl,
      compile: { success: true, error: null, reportedAt: new Date().toISOString() }
    };
    const update = { $set };
    if (glslChanged || needsThumb) {
      update.$unset = { thumbnail: "", thumbnailVersion: "" };
    }

    await col.updateOne({ id: sketch.id }, update);
    updated += 1;
    console.log(`${sketch.id}: saved${finalGlsl === FALLBACK ? " (fallback)" : ""}`);
  }

  await browser.close();
  await client.close();

  console.log(`Done. ${updated} sketch(s) updated, ${fallbacks} fallback(s).`);

  execSync(`node scripts/migrate-thumbnails-playwright.js ${base}`, {
    stdio: "inherit",
    cwd: path.join(__dirname, "..")
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});