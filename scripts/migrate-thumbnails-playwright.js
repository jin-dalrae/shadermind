/**
 * Headless browser run: triggers HD thumbnail backfill (WebGL capture + POST).
 * Usage: node scripts/migrate-thumbnails-playwright.js [baseUrl]
 */
import { chromium } from "playwright";
import { galleryThumbMigrationKey } from "../public/thumbnail-config.js";

const BASE = process.argv[2] || "http://localhost:8080";
const MIGRATION_KEY = galleryThumbMigrationKey();
const MAX_WAIT_MS = 8 * 60 * 1000;

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl"]
  });

  const page = await browser.newPage();
  let uploads = 0;

  page.on("response", async (res) => {
    if (res.url().includes("/api/sketches/thumbnail") && res.request().method() === "POST") {
      if (res.ok()) uploads += 1;
    }
  });

  console.log(`Opening ${BASE}/#gallery …`);
  await page.goto(`${BASE}/#gallery`, { waitUntil: "networkidle", timeout: 120000 });

  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, MIGRATION_KEY);

  await page.reload({ waitUntil: "networkidle", timeout: 120000 });
  await page.click('[data-page="gallery"]').catch(() => {});

  const started = Date.now();
  let lastLog = 0;

  while (Date.now() - started < MAX_WAIT_MS) {
    const status = await page.evaluate((key) => ({
      done: localStorage.getItem(key) === "done",
      uploads: window.__thumbUploadCount || 0
    }), MIGRATION_KEY);

    if (status.done) {
      console.log(`Migration complete. Thumbnail uploads this run: ${uploads}`);
      await browser.close();
      return;
    }

    if (Date.now() - lastLog > 5000) {
      console.log(`…still capturing (${uploads} uploaded so far)`);
      lastLog = Date.now();
    }

    await page.waitForTimeout(800);
  }

  await browser.close();
  console.error(`Timed out after ${MAX_WAIT_MS / 1000}s (${uploads} uploads).`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});