-- D1 schema for ShaderMind
-- Single JSON-blob storage: the entire database lives in one row.
-- For 84 sketches this is far simpler than a normalized schema and
-- performs fine. Normalize when sketch count exceeds ~10k.

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
