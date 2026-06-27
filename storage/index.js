import path from "path";
import { createJsonStorage } from "./json.js";
import { createSqliteStorage } from "./sqlite.js";

export function createStorage({ rootDir, defaultDb }) {
  const jsonPath = path.join(rootDir, "database.json");
  const useSqlite = process.env.USE_SQLITE === "true" || Boolean(process.env.SQLITE_PATH);
  const sqlitePath = process.env.SQLITE_PATH || path.join(rootDir, "shadermind.db");

  if (useSqlite) {
    return createSqliteStorage({
      dbPath: sqlitePath,
      jsonPath,
      defaultDb
    });
  }

  return createJsonStorage({ dbPath: jsonPath, defaultDb });
}
