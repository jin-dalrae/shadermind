/**
 * Remove placeholder/fallback shaders from MongoDB gallery.
 * Usage: node scripts/purge-placeholder-sketches.js
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import { isPlaceholderGlsl } from "../lib/glsl.js";

const AGENT_ID = "shadermind";

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI required");
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "shadermind");
  const col = db.collection("sketches");

  const sketches = await col.find({}).toArray();
  const removeIds = sketches
    .filter((s) => typeof s.glsl === "string" && isPlaceholderGlsl(s.glsl))
    .map((s) => s.id);

  if (!removeIds.length) {
    console.log("No placeholder sketches found.");
    await client.close();
    return;
  }

  const result = await col.deleteMany({ id: { $in: removeIds } });
  const remaining = await col.countDocuments();

  await db.collection("agent_state").updateOne(
    { _id: AGENT_ID },
    { $set: { totalSketches: remaining } }
  );

  console.log(`Removed ${result.deletedCount} placeholder sketch(s):`);
  for (const id of removeIds) console.log(`  - ${id}`);
  console.log(`Remaining sketches: ${remaining}`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});