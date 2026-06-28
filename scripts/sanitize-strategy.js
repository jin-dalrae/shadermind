#!/usr/bin/env node
/**
 * One-time migration: sanitize stored `currentStrategy` and `heuristics[]` in
 * `database.json` (or MongoDB) so they pass `STRATEGY_BANNED_RE`. Legacy data
 * pre-dates the strategy sanitizer on the LEARNING branch and may still
 * contain banned jargon ("emergent", "systemic", "pioneering",
 * "distributed intelligence", etc.) — even though new evolution output is
 * validated.
 *
 * Usage:
 *   node scripts/sanitize-strategy.js [--dry-run] [--target=json|mongo]
 *
 * Defaults: dry-run = false, target = json (file at DB_PATH).
 * Set MONGODB_URI to update MongoDB instead.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  sanitizeEvolvedStrategy,
  sanitizeHeuristics,
  STRATEGY_BANNED_RE
} from "../lib/learning/strategy.js";
import { DEFAULT_DB } from "../storage/default-db.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database.json");

// Threshold below which sanitizer output is too degraded to store — falls back to DEFAULT_DB.
// DEFAULT_DB.currentStrategy is ~470 chars; output below 300 is mostly leftover sentence fragments.
const STRATEGY_MIN_LENGTH = 300;
const HEURISTICS_MIN_COUNT = 2;

function parseArgs(argv) {
  const args = { dryRun: false, target: null };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--target=")) args.target = arg.split("=")[1];
  }
  if (!args.target) {
    args.target = process.env.MONGODB_URI ? "mongo" : "json";
  }
  return args;
}

function bannedWordsIn(text) {
  const matches = String(text || "").match(STRATEGY_BANNED_RE) || [];
  return [...new Set(matches.map(m => m.toLowerCase()))];
}

function summarize(label, before, after, bannedBefore, bannedAfter, fallbackUsed = false) {
  const lines = [
    `[${label}]`,
    `  before (${before.length} chars): ${before.slice(0, 100)}${before.length > 100 ? "…" : ""}`,
    `  after  (${after.length} chars): ${after.slice(0, 100)}${after.length > 100 ? "…" : ""}`,
    `  banned words before: ${bannedBefore.length ? bannedBefore.join(", ") : "(none)"}`,
    `  banned words after:  ${bannedAfter.length ? bannedAfter.join(", ") : "(none)"}`
  ];
  if (fallbackUsed) lines.push("  ⚠️  sanitizer output too degraded — falling back to DEFAULT_DB");
  return lines.join("\n");
}

function resolveStrategy(rawStrategy) {
  const sanitized = sanitizeEvolvedStrategy(rawStrategy);
  const fallbackUsed = sanitized.length < STRATEGY_MIN_LENGTH;
  return {
    value: fallbackUsed ? DEFAULT_DB.currentStrategy : sanitized,
    fallbackUsed
  };
}

function resolveHeuristics(rawHeuristics) {
  const sanitized = sanitizeHeuristics(rawHeuristics);
  const fallbackUsed = sanitized.length < HEURISTICS_MIN_COUNT;
  return {
    value: fallbackUsed ? [...DEFAULT_DB.heuristics] : sanitized,
    fallbackUsed
  };
}

function processJson(dryRun) {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database.json found at ${DB_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(DB_PATH, "utf8");
  const data = JSON.parse(raw);

  const beforeStrategy = data.currentStrategy || "";
  const beforeHeuristics = Array.isArray(data.heuristics) ? data.heuristics : [];

  const bannedStrategyBefore = bannedWordsIn(beforeStrategy);

  const strat = resolveStrategy(beforeStrategy);
  const heur = resolveHeuristics(beforeHeuristics);

  const bannedStrategyAfter = bannedWordsIn(strat.value);
  const bannedHeuristicsAfter = heur.value.flatMap(bannedWordsIn);

  console.log(`Source: ${DB_PATH}`);
  console.log(summarize("currentStrategy", beforeStrategy, strat.value, bannedStrategyBefore, bannedStrategyAfter, strat.fallbackUsed));
  console.log();
  console.log(`[heuristics] count before=${beforeHeuristics.length} after=${heur.value.length}${heur.fallbackUsed ? "  ⚠️  falling back to DEFAULT_DB" : ""}`);
  beforeHeuristics.forEach((h, i) => {
    const cleaned = heur.value[i] ?? "(dropped)";
    const b = bannedWordsIn(h);
    console.log(`  ${i + 1}. ${h}${b.length ? ` [banned: ${b.join(", ")}]` : ""}`);
    console.log(`     → ${cleaned}`);
  });
  if (bannedHeuristicsAfter.length) {
    console.log(`  still banned after sanitize: ${bannedHeuristicsAfter.join(", ")}`);
  }

  const strategyChanged = beforeStrategy !== strat.value;
  const heuristicsChanged =
    beforeHeuristics.length !== heur.value.length ||
    beforeHeuristics.some((h, i) => h !== heur.value[i]);

  if (!strategyChanged && !heuristicsChanged) {
    console.log("\nNo changes needed. Stored data is already clean.");
    return;
  }

  if (dryRun) {
    console.log("\n[dry-run] Would update database.json — re-run without --dry-run to apply.");
    return;
  }

  data.currentStrategy = strat.value;
  data.heuristics = heur.value;

  const backupPath = `${DB_PATH}.pre-sanitize.${Date.now()}.bak`;
  fs.writeFileSync(backupPath, raw, "utf8");
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");

  console.log(`\nUpdated ${DB_PATH}`);
  console.log(`Backup written: ${backupPath}`);
}

async function processMongo(dryRun) {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI required for --target=mongo");
    process.exit(1);
  }

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || "shadermind");
    const col = db.collection("agent_state");
    const doc = await col.findOne({ _id: "shadermind" });
    if (!doc) {
      console.error("No agent_state doc found in MongoDB");
      process.exit(1);
    }

    const beforeStrategy = doc.currentStrategy || "";
    const beforeHeuristics = Array.isArray(doc.heuristics) ? doc.heuristics : [];

    const strat = resolveStrategy(beforeStrategy);
    const heur = resolveHeuristics(beforeHeuristics);

    console.log(`Source: MongoDB ${process.env.MONGODB_DB || "shadermind"}.agent_state`);
    console.log(summarize(
      "currentStrategy",
      beforeStrategy,
      strat.value,
      bannedWordsIn(beforeStrategy),
      bannedWordsIn(strat.value),
      strat.fallbackUsed
    ));
    console.log(`\n[heuristics] count before=${beforeHeuristics.length} after=${heur.value.length}${heur.fallbackUsed ? "  ⚠️  falling back to DEFAULT_DB" : ""}`);

    const strategyChanged = beforeStrategy !== strat.value;
    const heuristicsChanged =
      beforeHeuristics.length !== heur.value.length ||
      beforeHeuristics.some((h, i) => h !== heur.value[i]);

    if (!strategyChanged && !heuristicsChanged) {
      console.log("\nNo changes needed. Stored data is already clean.");
      return;
    }

    if (dryRun) {
      console.log("\n[dry-run] Would update MongoDB — re-run without --dry-run to apply.");
      return;
    }

    await col.updateOne(
      { _id: "shadermind" },
      { $set: { currentStrategy: strat.value, heuristics: heur.value, updatedAt: new Date() } }
    );
    console.log("\nUpdated MongoDB agent_state.");
  } finally {
    await client.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[sanitize-strategy] target=${args.target} dryRun=${args.dryRun}\n`);

  if (args.target === "json") {
    processJson(args.dryRun);
  } else if (args.target === "mongo") {
    await processMongo(args.dryRun);
  } else {
    console.error(`Unknown target: ${args.target}. Use json or mongo.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});