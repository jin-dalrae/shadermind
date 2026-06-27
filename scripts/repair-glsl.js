/**
 * Permanently patch stored sketch GLSL in MongoDB (and optional JSON export).
 * Fixes missing/broken permute helpers and invalid .u/.v/.w swizzles.
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodeGlslField, validateGlsl } from "../lib/glsl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

async function repairCollection(collection, label) {
  const sketches = await collection.find({}).toArray();
  let updated = 0;

  for (const sketch of sketches) {
    if (typeof sketch.glsl !== "string") continue;
    const patched = decodeGlslField(sketch.glsl);
    if (patched === sketch.glsl) continue;

    const validation = validateGlsl(patched);
    await collection.updateOne({ id: sketch.id }, { $set: { glsl: patched } });
    updated += 1;
    console.log(
      `[${label}] ${sketch.id} gen${sketch.generation} patched` +
        (validation.valid ? " (valid)" : ` (${validation.reason})`)
    );
  }

  return updated;
}

async function repairJson() {
  const jsonPath = path.join(root, "database.json");
  const db = JSON.parse(readFileSync(jsonPath, "utf8"));
  let updated = 0;

  for (const sketch of db.sketches) {
    if (typeof sketch.glsl !== "string") continue;
    const patched = decodeGlslField(sketch.glsl);
    if (patched === sketch.glsl) continue;
    sketch.glsl = patched;
    updated += 1;
    const validation = validateGlsl(patched);
    console.log(
      `[json] ${sketch.id} patched` +
        (validation.valid ? " (valid)" : ` (${validation.reason})`)
    );
  }

  if (updated) {
    writeFileSync(jsonPath, `${JSON.stringify(db, null, 2)}\n`);
  }
  return updated;
}

async function main() {
  let total = 0;

  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || "shadermind");
    total += await repairCollection(db.collection("sketches"), "mongo");
    await client.close();
  } else {
    console.log("MONGODB_URI not set — skipping Mongo repair");
  }

  total += await repairJson();
  console.log(`Done. ${total} sketch(s) updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});