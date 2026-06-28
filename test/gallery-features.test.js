import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

const SERVER_JS = new URL("../server.js", import.meta.url);
const APP_JS = new URL("../public/app.js", import.meta.url);

test("server.js registers DELETE /api/sketches/:id endpoint", () => {
  const src = fs.readFileSync(SERVER_JS, "utf8");
  const match = src.match(/app\.delete\("\/api\/sketches\/:id"[\s\S]*?\n\}\);/);
  assert.ok(match, "DELETE /api/sketches/:id endpoint must exist in server.js");
  const block = match[0];
  assert.ok(/db\.sketches\.splice/.test(block), "endpoint must splice the sketch out of db.sketches");
  assert.ok(/await saveDB\(db\)/.test(block), "endpoint must persist via saveDB");
  assert.ok(/404/.test(block), "endpoint must return 404 for missing sketch");
});

test("server.js /api/sketches filter handles multi-select arrays for generation and rating", () => {
  const src = fs.readFileSync(SERVER_JS, "utf8");
  const match = src.match(/app\.get\("\/api\/sketches"[\s\S]*?\n\}\);/);
  assert.ok(match, "/api/sketches endpoint must exist");
  const block = match[0];
  assert.ok(/toArray/.test(block), "endpoint must normalize query param to array");
  assert.ok(/generations/.test(block), "endpoint must accept multi-generation filter");
  assert.ok(/ratings/.test(block), "endpoint must accept multi-rating filter");
  assert.ok(/Number\.isFinite/.test(block), "endpoint must coerce generation to number");
});

test("/api/sketches rating filter handles 4+ shorthand (ratings >= 4)", () => {
  const src = fs.readFileSync(SERVER_JS, "utf8");
  const match = src.match(/app\.get\("\/api\/sketches"[\s\S]*?\n\}\);/);
  const block = match[0];
  assert.ok(/if \(r === "4"\)\s+return\s+Number\(s\.rating\) >=\s*4/.test(block),
    "rating filter '4' should match ratings >= 4");
  assert.ok(/if \(r === "2"\)\s+return\s+Number\(s\.rating\) <=\s*2/.test(block),
    "rating filter '2' should match ratings <= 2");
});

test("public/app.js has multi-select gallery filter logic", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  assert.ok(/getSelectedFilters\(/.test(src), "app.js must have getSelectedFilters helper for multi-select");
  assert.ok(/setSelectedFilters\(/.test(src), "app.js must have setSelectedFilters helper");
  assert.ok(/populateGenerationFilter/.test(src), "app.js must populate generation filter dynamically");
  assert.ok(/input\[type="checkbox"\]:checked/.test(src), "app.js must read multi-select via :checked pseudo");
  assert.ok(/params\.append\("generation"/.test(src), "app.js must send generation as repeated query param");
  assert.ok(/params\.append\("rating"/.test(src), "app.js must send rating as repeated query param");
});

test("public/app.js has Refresh thumbnails button wired to migration handler", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  assert.ok(/galleryRefreshThumbs/.test(src), "app.js must reference the refresh button element");
  assert.ok(/refreshGalleryThumbnails/.test(src), "app.js must have a refreshGalleryThumbnails method");
  assert.ok(/runGalleryThumbnailMigrationNow/.test(src),
    "app.js must have an explicit one-shot migration method (without localStorage short-circuit)");
  assert.ok(/thumbBackfillAttempted\.clear/.test(src),
    "refresh must reset the attempted-failed set so previously-failed sketches retry");
  assert.ok(/localStorage\.removeItem\(galleryThumbMigrationKey/.test(src),
    "refresh must clear the localStorage 'done' flag so the migration re-runs");
});

test("public/app.js archive cell renders delete button + model tag", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  assert.ok(/archive-delete-btn/.test(src), "delete button class must exist");
  assert.ok(/archive-model-tag/.test(src), "model provenance tag class must exist");
  assert.ok(/archive-actions/.test(src), "archive actions container class must exist");
  assert.ok(/deleteGallerySketch\(/.test(src), "deleteGallerySketch handler must exist");
  assert.ok(/DELETE"/.test(src) || /method:\s*"DELETE"/.test(src),
    "delete must use HTTP DELETE");
  assert.ok(/window\.confirm\(/.test(src), "delete should confirm before destroying data");
  assert.ok(/cannot be undone/i.test(src), "delete confirmation should warn about irreversibility");
});

test("public/app.js archive cell excludes delete from dialog-open click", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  const cellClick = src.match(/cell\.addEventListener\("click"[\s\S]*?\}\);/);
  assert.ok(cellClick, "archive cell click handler must exist");
  const block = cellClick[0];
  assert.ok(/\.archive-delete-btn/.test(block),
    "cell click must early-return when clicking the delete button to avoid opening the dialog");
});

test("public/index.html exposes new filter UI + refresh button", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(/id="galleryRefreshThumbs"/.test(html), "Refresh thumbnails button id must exist");
  assert.ok(/id="galleryFilterGenField"/.test(html), "Multi-select generation fieldset id must exist");
  assert.ok(/id="galleryFilterRatingField"/.test(html), "Multi-select rating fieldset id must exist");
  assert.ok(/filter-chips/.test(html), "Chip container class must exist");
  assert.ok(/<input type="checkbox" value="5">/.test(html), "Rating 5 checkbox must exist");
});

test("public/index.css styles the multi-select filter + delete button + model tag", () => {
  const css = fs.readFileSync(new URL("../public/index.css", import.meta.url), "utf8");
  assert.ok(/\.filter-multi/.test(css), "Filter-multi class must be styled");
  assert.ok(/\.filter-chips/.test(css), "Filter-chips container must be styled");
  assert.ok(/\.filter-chip/.test(css), "Individual filter chip must be styled");
  assert.ok(/\.archive-delete-btn/.test(css), "Archive delete button must be styled");
  assert.ok(/\.archive-model-tag/.test(css), "Archive model tag must be styled");
  assert.ok(/\.archive-actions/.test(css), "Archive actions container must be styled");
  assert.ok(/\.btn-refresh-thumbs/.test(css), "Refresh thumbnails button must be styled");
});

test("runGalleryThumbnailMigrationOnce no longer short-circuits on stale localStorage 'done' flag", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  const fn = src.match(/async runGalleryThumbnailMigrationOnce\(\)\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "runGalleryThumbnailMigrationOnce must exist");
  const block = fn[0];
  assert.ok(!/if \(localStorage\.getItem\(key\) === "done"\)\s*return/.test(block),
    "early-return on localStorage 'done' must be removed — it caused the migration to skip on partial completion");
  assert.ok(/if \(!needsUpgrade\.length\)/.test(block),
    "function should return when there are no sketches needing thumbnails (state-based check)");
});

test("server.js /api/sketches DELETE endpoint persists via saveDB", () => {
  const src = fs.readFileSync(SERVER_JS, "utf8");
  const match = src.match(/app\.delete\("\/api\/sketches\/:id"[\s\S]*?\n\}\);/);
  assert.ok(match);
  const block = match[0];
  assert.ok(/db\.sketches\.findIndex/.test(block), "must find sketch by id");
  assert.ok(/db\.totalSketches/.test(block), "must decrement totalSketches counter");
  assert.ok(/await saveDB\(db\)/.test(block), "must persist deletion via saveDB");
});