#!/usr/bin/env node
/**
 * Push the current in-memory DB (from active storage) to MongoDB.
 * Use when local dev already uses Atlas and you want to refresh the remote copy.
 * Does NOT read stale database.json unless that's your active storage.
 */
import dotenv from "dotenv";
import { loadDB, saveDB, getStorageMode } from "../storage/index.js";

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }

  const before = getStorageMode();
  const db = await loadDB();
  console.log(`Loaded via ${before}: gen ${db.generationCount}, ${db.sketches.length} sketches`);

  if (before !== "mongo") {
    console.log("Re-saving through MongoDB storage...");
    process.env.MONGODB_URI = uri;
  }
  await saveDB(db);
  console.log("MongoDB snapshot saved.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});