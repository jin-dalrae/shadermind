import fs from "fs";
import path from "path";
import { DEFAULT_DB, mergeWithDefaults } from "./default-db.js";

export class JsonStorage {
  constructor(dbPath) {
    this.dbPath = dbPath;
    if (!fs.existsSync(this.dbPath)) {
      this.saveSync(DEFAULT_DB);
    }
  }

  saveSync(data) {
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), "utf8");
  }

  async load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, "utf8");
        return mergeWithDefaults(JSON.parse(raw));
      }
    } catch (err) {
      console.error("Error loading database, returning default:", err);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }

  async save(data) {
    this.saveSync(data);
  }

  async getSketchesPaginated({ page = 1, limit = 20, generation, rating } = {}) {
    const db = await this.load();
    let items = [...db.sketches];

    if (generation != null) {
      items = items.filter(s => s.generation === Number(generation));
    }
    if (rating) {
      items = items.filter(s => s.rating === rating);
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

  async getStrategyTimeline({ limit = 20, skip = 0 } = {}) {
    const db = await this.load();
    const timeline = [...(db.strategyTimeline || [])]
      .filter(t => t.generation > 0)
      .sort((a, b) => b.generation - a.generation);
    return {
      items: timeline.slice(skip, skip + limit),
      total: timeline.length
    };
  }

  async getLatestRollup() {
    const db = await this.load();
    return (db.memoryRollups || []).at(-1) || null;
  }
}