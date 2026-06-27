import path from "path";
import { fileURLToPath } from "url";
import { JsonStorage } from "./json-storage.js";
import { MongoStorage } from "./mongo-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let storageInstance = null;
let storageMode = null;

function createJsonStorage() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "database.json");
  console.log(`Storage: JSON (${dbPath})`);
  storageInstance = new JsonStorage(dbPath);
  storageMode = "json";
  return storageInstance;
}

export function createStorage() {
  if (storageInstance) return storageInstance;

  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    console.log(`Storage: MongoDB (${process.env.MONGODB_DB || "shadermind"})`);
    storageInstance = new MongoStorage(mongoUri, process.env.MONGODB_DB || "shadermind");
    storageMode = "mongo";
  } else {
    createJsonStorage();
  }
  return storageInstance;
}

async function fallbackToJson(reason) {
  console.warn(`[Storage] MongoDB unavailable (${reason}) — falling back to database.json`);
  const prev = storageInstance;
  storageInstance = null;
  storageMode = null;
  if (prev?.close) {
    try {
      await prev.close();
    } catch {
      // ignore close errors during failover
    }
  }
  return createJsonStorage().load();
}

export async function loadDB() {
  const storage = createStorage();
  if (storageMode !== "mongo") {
    return storage.load();
  }

  try {
    return await storage.load();
  } catch (err) {
    return fallbackToJson(err.message);
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
    console.warn(`[Storage] MongoDB save failed (${err.message}) — writing to database.json`);
    return fallbackToJson(err.message).then(() => createJsonStorage().save(data));
  }
}