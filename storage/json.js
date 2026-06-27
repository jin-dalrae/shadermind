import fs from "fs";

export function writeJsonSnapshot(dbPath, data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf8");
}

export function createJsonStorage({ dbPath, defaultDb }) {
  function loadDB() {
    try {
      if (fs.existsSync(dbPath)) {
        const raw = fs.readFileSync(dbPath, "utf8");
        const parsed = JSON.parse(raw);
        return { ...JSON.parse(JSON.stringify(defaultDb)), ...parsed };
      }
    } catch (err) {
      console.error("Error loading database.json, returning default:", err);
    }
    return JSON.parse(JSON.stringify(defaultDb));
  }

  function saveDB(data) {
    try {
      writeJsonSnapshot(dbPath, data);
    } catch (err) {
      console.error("Error saving database.json:", err);
    }
  }

  function initStorage() {
    if (!fs.existsSync(dbPath)) {
      saveDB(defaultDb);
    }
    console.log(`Storage: JSON file at ${dbPath}`);
  }

  return { loadDB, saveDB, initStorage, backend: "json" };
}
