#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { MongoStorage } from "../storage/mongo-storage.js";
import { mergeWithDefaults } from "../storage/default-db.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database.json");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required. Add it to .env and retry.");
    process.exit(1);
  }

  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database.json found at ${DB_PATH}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const data = mergeWithDefaults(raw);

  const storage = new MongoStorage(uri, process.env.MONGODB_DB || "shadermind");
  await storage.save(data);
  await storage.close();

  console.log("Migration complete:");
  console.log(`  sketches: ${data.sketches.length}`);
  console.log(`  generations: ${data.generationCount}`);
  console.log(`  timeline entries: ${data.strategyTimeline.length}`);
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});