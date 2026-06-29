// D1 storage layer for ShaderMind.
// Stores the database as chunked rows in the `kv` table.
// The entire database is serialized as JSON, then split into ~50KB
// chunks (D1's per-statement SQL limit is 100KB). On read, chunks
// are concatenated and parsed back into an object.

import { mergeWithDefaults, DEFAULT_DB } from "./default-db.js";

const CHUNK_PREFIX = "db_chunk_";
const CHUNK_COUNT_KEY = "db_chunk_count";
const CHUNK_SIZE = 50000;

export async function loadDB(env) {
  const countRow = await env.DB.prepare(
    "SELECT value FROM kv WHERE key = ?"
  ).bind(CHUNK_COUNT_KEY).first();

  if (!countRow) {
    await saveDB(env, DEFAULT_DB);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }

  const chunkCount = parseInt(countRow.value, 10) || 0;
  if (chunkCount === 0) {
    await saveDB(env, DEFAULT_DB);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }

  const placeholders = Array.from({ length: chunkCount }, () => "?").join(",");
  const keys = Array.from({ length: chunkCount }, (_, i) => `${CHUNK_PREFIX}${i}`);
  const result = await env.DB.prepare(
    `SELECT key, value FROM kv WHERE key IN (${placeholders}) ORDER BY key`
  ).bind(...keys).all();

  const sorted = (result.results || []).sort((a, b) => {
    const ai = parseInt(a.key.split("_").pop(), 10);
    const bi = parseInt(b.key.split("_").pop(), 10);
    return ai - bi;
  });

  const json = sorted.map(r => r.value).join("");
  try {
    const parsed = JSON.parse(json);
    return mergeWithDefaults(parsed);
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

export async function saveDB(env, db) {
  const value = JSON.stringify(db);
  const chunks = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }

  const statements = [
    env.DB.prepare("DELETE FROM kv WHERE key LIKE 'db_chunk_%' OR key = ?")
      .bind(CHUNK_COUNT_KEY)
  ];

  chunks.forEach((chunk, i) => {
    statements.push(
      env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?)")
        .bind(`${CHUNK_PREFIX}${i}`, chunk)
    );
  });

  statements.push(
    env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?)")
      .bind(CHUNK_COUNT_KEY, String(chunks.length))
  );

  await env.DB.batch(statements);
}
