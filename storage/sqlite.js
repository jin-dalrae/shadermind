import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import { writeJsonSnapshot } from "./json.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_sketches INTEGER NOT NULL DEFAULT 0,
  generation_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0,
  current_strategy TEXT NOT NULL DEFAULT '',
  heuristics_json TEXT NOT NULL DEFAULT '[]',
  preference_memory_json TEXT NOT NULL DEFAULT '{}',
  statistics_json TEXT NOT NULL DEFAULT '{"generations":[],"popularTags":[]}'
);

CREATE TABLE IF NOT EXISTS strategy_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  strategy TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS sketches (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  rating TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sketches_generation ON sketches(generation);
CREATE INDEX IF NOT EXISTS idx_sketches_rating ON sketches(rating);
`;

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createSqliteStorage({ dbPath, jsonPath, defaultDb }) {
  const db = new DatabaseSync(dbPath);
  const mirrorJson = process.env.JSON_MIRROR !== "false";
  db.exec(SCHEMA);

  function mirrorToJson(data) {
    if (!mirrorJson) return;
    try {
      writeJsonSnapshot(jsonPath, data);
    } catch (err) {
      console.error("Error mirroring to database.json:", err.message);
    }
  }

  function loadDB() {
    const state = db.prepare("SELECT * FROM agent_state WHERE id = 1").get();
    if (!state) {
      return JSON.parse(JSON.stringify(defaultDb));
    }

    const strategyTimeline = db.prepare(
      "SELECT generation, timestamp, strategy, notes FROM strategy_timeline ORDER BY generation ASC, id ASC"
    ).all();

    const sketchRows = db.prepare(
      "SELECT payload_json FROM sketches ORDER BY generation ASC, id ASC"
    ).all();

    return {
      totalSketches: state.total_sketches,
      generationCount: state.generation_count,
      successRate: state.success_rate,
      currentStrategy: state.current_strategy,
      heuristics: parseJson(state.heuristics_json, []),
      preferenceMemory: parseJson(state.preference_memory_json, defaultDb.preferenceMemory),
      strategyTimeline,
      sketches: sketchRows.map(row => parseJson(row.payload_json, null)).filter(Boolean),
      statistics: parseJson(state.statistics_json, defaultDb.statistics)
    };
  }

  function saveDB(data) {
    db.exec("BEGIN");
    try {
      db.prepare(`
        INSERT INTO agent_state (
          id, total_sketches, generation_count, success_rate, current_strategy,
          heuristics_json, preference_memory_json, statistics_json
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          total_sketches = excluded.total_sketches,
          generation_count = excluded.generation_count,
          success_rate = excluded.success_rate,
          current_strategy = excluded.current_strategy,
          heuristics_json = excluded.heuristics_json,
          preference_memory_json = excluded.preference_memory_json,
          statistics_json = excluded.statistics_json
      `).run(
        data.totalSketches ?? 0,
        data.generationCount ?? 0,
        data.successRate ?? 0,
        data.currentStrategy ?? "",
        JSON.stringify(data.heuristics ?? []),
        JSON.stringify(data.preferenceMemory ?? defaultDb.preferenceMemory),
        JSON.stringify(data.statistics ?? defaultDb.statistics)
      );

      db.prepare("DELETE FROM strategy_timeline").run();
      const insertTimeline = db.prepare(`
        INSERT INTO strategy_timeline (generation, timestamp, strategy, notes)
        VALUES (?, ?, ?, ?)
      `);
      for (const entry of data.strategyTimeline ?? []) {
        insertTimeline.run(
          entry.generation ?? 0,
          entry.timestamp ?? new Date().toISOString(),
          entry.strategy ?? "",
          entry.notes ?? null
        );
      }

      db.prepare("DELETE FROM sketches").run();
      const insertSketch = db.prepare(`
        INSERT INTO sketches (id, generation, rating, payload_json)
        VALUES (?, ?, ?, ?)
      `);
      for (const sketch of data.sketches ?? []) {
        insertSketch.run(
          sketch.id,
          sketch.generation ?? 0,
          sketch.rating ?? null,
          JSON.stringify(sketch)
        );
      }

      db.exec("COMMIT");
      mirrorToJson(data);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function migrateFromJsonIfEmpty() {
    const sketchCount = db.prepare("SELECT COUNT(*) AS count FROM sketches").get().count;
    const hasState = db.prepare("SELECT COUNT(*) AS count FROM agent_state").get().count;
    if (sketchCount > 0 || hasState > 0) return false;
    if (!fs.existsSync(jsonPath)) return false;

    try {
      const raw = fs.readFileSync(jsonPath, "utf8");
      const parsed = JSON.parse(raw);
      saveDB({ ...JSON.parse(JSON.stringify(defaultDb)), ...parsed });
      console.log(`Storage: migrated ${parsed.sketches?.length ?? 0} sketches from ${jsonPath}`);
      return true;
    } catch (err) {
      console.error("SQLite migration from JSON failed:", err.message);
      return false;
    }
  }

  function initStorage() {
    migrateFromJsonIfEmpty();

    const state = db.prepare("SELECT COUNT(*) AS count FROM agent_state").get().count;
    if (state === 0) {
      saveDB(defaultDb);
    }

    const sketchCount = db.prepare("SELECT COUNT(*) AS count FROM sketches").get().count;
    if (mirrorJson) {
      mirrorToJson(loadDB());
    }
    console.log(
      `Storage: SQLite at ${dbPath} (${sketchCount} sketches)` +
      (mirrorJson ? ` + JSON mirror at ${jsonPath}` : "")
    );
  }

  return { loadDB, saveDB, initStorage, backend: "sqlite" };
}
