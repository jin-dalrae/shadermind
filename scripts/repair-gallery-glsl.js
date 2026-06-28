/**
 * Repair stored GLSL for broken gallery sketches, verify in headless WebGL, persist to Mongo.
 * Unfixable shaders are deleted — no placeholder substitution.
 * Usage: node scripts/repair-gallery-glsl.js
 */
import "dotenv/config";
import { chromium } from "playwright";
import { MongoClient } from "mongodb";
import { decodeGlslField, isPlaceholderGlsl } from "../lib/glsl.js";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ID = "shadermind";

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
  const db = client.db(process.env.MONGODB_DB || "shadermind");
  const col = db.collection("sketches");
  const sketches = await col.find({}).toArray();

  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage();

  let updated = 0;
  let removed = 0;

  for (const sketch of sketches) {
    if (typeof sketch.glsl !== "string") continue;

    if (isPlaceholderGlsl(sketch.glsl)) {
      await col.deleteOne({ id: sketch.id });
      removed += 1;
      console.log(`${sketch.id}: removed (placeholder)`);
      continue;
    }

    const patched = repairGlsl(sketch.glsl);
    let check = await compileCheck(page, patched);
    let finalGlsl = patched;

    if (!check.ok) {
      console.log(
        `${sketch.id}: ${(check.log || "compile failed").replace(/\s+/g, " ").slice(0, 140)}`
      );
      await col.deleteOne({ id: sketch.id });
      removed += 1;
      console.log(`${sketch.id}: removed (unfixable)`);
      continue;
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
    console.log(`${sketch.id}: saved`);
  }

  const remaining = await col.countDocuments();
  await db.collection("agent_state").updateOne(
    { _id: AGENT_ID },
    { $set: { totalSketches: remaining } }
  );

  await browser.close();
  await client.close();

  console.log(`Done. ${updated} repaired, ${removed} removed. ${remaining} sketches remain.`);

  execSync(`node scripts/migrate-thumbnails-playwright.js ${base}`, {
    stdio: "inherit",
    cwd: path.join(__dirname, "..")
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});