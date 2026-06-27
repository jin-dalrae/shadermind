import path from "path";
import { fileURLToPath } from "url";
import { JsonStorage } from "./json-storage.js";
import { MongoStorage } from "./mongo-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let storageInstance = null;

export function createStorage() {
  if (storageInstance) return storageInstance;

  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    console.log(`Storage: MongoDB (${process.env.MONGODB_DB || "shadermind"})`);
    storageInstance = new MongoStorage(mongoUri, process.env.MONGODB_DB || "shadermind");
  } else {
    const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "database.json");
    console.log(`Storage: JSON (${dbPath})`);
    storageInstance = new JsonStorage(dbPath);
  }
  return storageInstance;
}

export async function loadDB() {
  return createStorage().load();
}

export async function saveDB(data) {
  return createStorage().save(data);
}