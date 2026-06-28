import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_DB, mergeWithDefaults } from "./default-db.js";
import { JsonStorage } from "./json-storage.js";
import { MongoStorage } from "./mongo-storage.js";

/** Only load when SQLite is enabled — avoids Node 20 crash on `node:sqlite` at boot. */
let createSqliteStorage = null;
if (process.env.USE_SQLITE === "true" || process.env.SQLITE_PATH) {
  ({ createSqliteStorage } = await import("./sqlite.js"));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

let storageInstance = null;
let storageMode = null;
let lastMongoError = null;

function paginateSketches(db, { page = 1, limit = 20, generation, rating } = {}) {
  let items = [...db.sketches];

  if (generation != null) {
    items = items.filter(s => s.generation === Number(generation));
  }
  if (rating) {
    const min = Number(rating);
    items = items.filter(s => {
      const r = Number(s.rating);
      if (!Number.isFinite(r)) return false;
      if (rating === "4") return r >= 4;
      if (rating === "2") return r <= 2;
      return r === min;
    });
  }

  items.sort((a, b) => {
    if (b.generation !== a.generation) return b.generation - a.generation;
    return String(b.id).localeCompare(String(a.id));
  });

  const total = items.length;
  const skip = (Math.max(1, page) - 1) * limit;
  return {
    items: items.slice(skip, skip + limit),
    page: Math.max(1, page),
    limit,
    total,
    pages: Math.ceil(total / limit) || 1
  };
}

function wrapSqliteStorage(sqlite) {
  return {
    async load() {
      return mergeWithDefaults(sqlite.loadDB());
    },
    async save(data) {
      return sqlite.saveDB(data);
    },
    async getSketchesPaginated(opts) {
      const db = await this.load();
      return paginateSketches(db, opts);
    },
    async getStrategyTimeline({ limit = 20, skip = 0 } = {}) {
      const db = await this.load();
      const timeline = [...(db.strategyTimeline || [])]
        .filter(t => t.generation > 0)
        .sort((a, b) => b.generation - a.generation);
      return {
        items: timeline.slice(skip, skip + limit),
        total: timeline.length
      };
    },
    async getLatestRollup() {
      const db = await this.load();
      return (db.memoryRollups || []).at(-1) || null;
    },
    async close() {}
  };
}

function createJsonStorageInstance() {
  const dbPath = process.env.DB_PATH || path.join(rootDir, "database.json");
  console.log(`Storage: JSON (${dbPath})`);
  storageInstance = new JsonStorage(dbPath);
  storageMode = "json";
  return storageInstance;
}

function createSqliteStorageInstance() {
  if (!createSqliteStorage) {
    throw new Error(
      "SQLite storage requires Node 22+ and USE_SQLITE=true (built-in node:sqlite)."
    );
  }
  const jsonPath = process.env.DB_PATH || path.join(rootDir, "database.json");
  const sqlitePath = process.env.SQLITE_PATH || path.join(rootDir, "shadermind.db");
  const sqlite = createSqliteStorage({
    dbPath: sqlitePath,
    jsonPath,
    defaultDb: DEFAULT_DB
  });
  sqlite.initStorage();
  storageInstance = wrapSqliteStorage(sqlite);
  storageMode = "sqlite";
  console.log(`Storage: SQLite (${sqlitePath})`);
  return storageInstance;
}

export function getStorageMode() {
  createStorage();
  return storageMode || "unknown";
}

export function getStorageDiagnostics() {
  createStorage();
  return {
    mode: storageMode || "unknown",
    mongoConfigured: Boolean(process.env.MONGODB_URI),
    mongoDb: process.env.MONGODB_DB || "shadermind",
    mongoError: lastMongoError
  };
}

export function createStorage() {
  if (storageInstance) return storageInstance;

  const useSqlite = process.env.USE_SQLITE === "true" || Boolean(process.env.SQLITE_PATH);
  if (useSqlite) {
    return createSqliteStorageInstance();
  }

  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    console.log(`Storage: MongoDB (${process.env.MONGODB_DB || "shadermind"})`);
    storageInstance = new MongoStorage(mongoUri, process.env.MONGODB_DB || "shadermind");
    storageMode = "mongo";
  } else {
    createJsonStorageInstance();
  }
  return storageInstance;
}

function failMongo(message) {
  lastMongoError = message;
  const dbName = process.env.MONGODB_DB || "shadermind";
  throw new Error(
    `MongoDB required (db=${dbName}) but unavailable: ${message}. `
    + "Fix MONGODB_URI, Atlas network access, or credentials — no JSON fallback."
  );
}

/** Fail fast at boot when MONGODB_URI is set — production must not silently use database.json. */
export async function assertStorageReady() {
  if (!process.env.MONGODB_URI) return;
  try {
    lastMongoError = null;
    await createStorage().load();
  } catch (err) {
    failMongo(err.message);
  }
}

export async function loadDB() {
  const storage = createStorage();
  if (storageMode !== "mongo") {
    return storage.load();
  }

  try {
    lastMongoError = null;
    return await storage.load();
  } catch (err) {
    failMongo(err.message);
  }
}

export async function saveDB(data) {
  const storage = createStorage();
  if (storageMode !== "mongo") {
    return storage.save(data);
  }

  try {
    return await storage.save(data);
  } catch (err) {
    failMongo(err.message);
  }
}