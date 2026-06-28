import { MongoClient } from "mongodb";
import { DEFAULT_DB, mergeWithDefaults } from "./default-db.js";

const AGENT_ID = "shadermind";
const GENERATION_LOCK_TTL_MS = Number(process.env.GENERATION_LOCK_TTL_MS) || 600000;

export class MongoStorage {
  constructor(uri, dbName = "shadermind") {
    this.uri = uri;
    this.dbName = dbName;
    this.client = null;
    this.db = null;
  }

  async connect() {
    if (this.db) return this.db;
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await this.db.collection("generations").createIndex({ generation: 1 }, { unique: true });
    await this.db.collection("sketches").createIndex({ id: 1 }, { unique: true });
    await this.db.collection("sketches").createIndex({ generation: 1 });
    await this.db.collection("sketches").createIndex({ rating: 1, generation: -1 });
    return this.db;
  }

  async load() {
    const db = await this.connect();
    const agent = await db.collection("agent_state").findOne({ _id: AGENT_ID });
    if (!agent) {
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }

    const sketches = await db.collection("sketches").find({}).sort({ generation: 1, id: 1 }).toArray();
    const generations = await db.collection("generations").find({}).sort({ generation: 1 }).toArray();
    const rollups = await db.collection("memory_rollups").find({}).sort({ toGeneration: 1 }).toArray();

    const strategyTimeline = generations.map(g => ({
      generation: g.generation,
      timestamp: g.timestamp,
      strategy: g.strategySnapshot || g.strategy,
      notes: g.reflection || g.notes || "",
      curatorSource: g.curatorSource
    }));

    if (!strategyTimeline.some(t => t.generation === 0)) {
      strategyTimeline.unshift(DEFAULT_DB.strategyTimeline[0]);
    }

    return mergeWithDefaults({
      totalSketches: agent.totalSketches ?? sketches.length,
      generationCount: agent.generationCount ?? 0,
      successRate: agent.successRate ?? 0,
      learningMode: agent.learningMode ?? "human",
      lastConsolidationGen: agent.lastConsolidationGen ?? 0,
      currentStrategy: agent.currentStrategy ?? DEFAULT_DB.currentStrategy,
      heuristics: agent.heuristics ?? DEFAULT_DB.heuristics,
      strategyTimeline,
      sketches: sketches.map(s => ({
        id: s.id,
        title: s.title,
        type: s.type,
        hypothesis: s.hypothesis,
        glsl: s.glsl,
        poetic_statement: s.poetic_statement,
        generation: s.generation,
        rated: s.rated,
        rating: s.rating,
        dna: s.dna,
        thumbnail: s.thumbnail || null,
        curatorSource: s.curatorSource
      })),
      statistics: agent.statistics ?? { generations: [], popularTags: [] },
      memoryRollups: rollups.map(r => ({
        fromGeneration: r.fromGeneration,
        toGeneration: r.toGeneration,
        summary: r.summary,
        heuristics: r.heuristics,
        keyLearnings: r.keyLearnings,
        createdAt: r.createdAt
      })),
      pendingBatch: agent.pendingBatch || null,
      lastHumanOpinion: agent.lastHumanOpinion || null,
      generationLock: agent.generationLock || null,
      patternStats: agent.patternStats || null
    });
  }

  async save(data) {
    const db = await this.connect();

    await db.collection("agent_state").updateOne(
      { _id: AGENT_ID },
      {
        $set: {
          totalSketches: data.totalSketches,
          generationCount: data.generationCount,
          successRate: data.successRate,
          currentStrategy: data.currentStrategy,
          heuristics: data.heuristics,
          learningMode: data.learningMode,
          lastConsolidationGen: data.lastConsolidationGen,
          statistics: data.statistics,
          pendingBatch: data.pendingBatch ?? null,
          lastHumanOpinion: data.lastHumanOpinion ?? null,
          patternStats: data.patternStats ?? null,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    if (data.sketches?.length) {
      const ops = data.sketches.map(s => ({
        updateOne: {
          filter: { id: s.id },
          update: {
            $set: {
              ...s,
              createdAt: s.createdAt || new Date()
            }
          },
          upsert: true
        }
      }));
      await db.collection("sketches").bulkWrite(ops, { ordered: false });
    }

    const genEntries = (data.strategyTimeline || []).filter(t => t.generation > 0);
    for (const entry of genEntries) {
      const stat = (data.statistics?.generations || []).find(g => g.generation === entry.generation);
      await db.collection("generations").updateOne(
        { generation: entry.generation },
        {
          $set: {
            generation: entry.generation,
            timestamp: entry.timestamp,
            reflection: entry.notes,
            strategySnapshot: entry.strategy,
            curatorSource: entry.curatorSource || "human",
            goodCount: stat?.goodCount,
            badCount: stat?.badCount,
            successRate: stat?.successRate
          }
        },
        { upsert: true }
      );
    }

    if (data.memoryRollups?.length) {
      const latest = data.memoryRollups.at(-1);
      await db.collection("memory_rollups").updateOne(
        { fromGeneration: latest.fromGeneration, toGeneration: latest.toGeneration },
        { $set: { ...latest, createdAt: latest.createdAt || new Date() } },
        { upsert: true }
      );
    }
  }

  async getSketchesPaginated({ page = 1, limit = 20, generation, rating } = {}) {
    const db = await this.connect();
    const filter = {};
    if (generation != null) filter.generation = Number(generation);
    if (rating === "4") filter.rating = { $gte: 4 };
    else if (rating === "2") filter.rating = { $lte: 2 };
    else if (rating) filter.rating = Number(rating);

    const total = await db.collection("sketches").countDocuments(filter);
    const skip = (Math.max(1, page) - 1) * limit;
    const items = await db.collection("sketches")
      .find(filter)
      .sort({ generation: -1, id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return {
      items,
      page: Math.max(1, page),
      limit,
      total,
      pages: Math.ceil(total / limit) || 1
    };
  }

  async getStrategyTimeline({ limit = 20, skip = 0 } = {}) {
    const db = await this.connect();
    const filter = { generation: { $gt: 0 } };
    const total = await db.collection("generations").countDocuments(filter);
    const items = await db.collection("generations")
      .find(filter)
      .sort({ generation: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return {
      items: items.map(g => ({
        generation: g.generation,
        timestamp: g.timestamp,
        strategy: g.strategySnapshot,
        notes: g.reflection,
        curatorSource: g.curatorSource
      })),
      total
    };
  }

  async getLatestRollup() {
    const db = await this.connect();
    return db.collection("memory_rollups").findOne({}, { sort: { toGeneration: -1 } });
  }

  async getGenerationLock() {
    const db = await this.connect();
    const agent = await db.collection("agent_state").findOne(
      { _id: AGENT_ID },
      { projection: { generationLock: 1 } }
    );
    return agent?.generationLock || null;
  }

  async tryAcquireGenerationLock(holderId, generation, ttlMs = GENERATION_LOCK_TTL_MS) {
    const db = await this.connect();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    await db.collection("agent_state").updateOne(
      { _id: AGENT_ID },
      { $setOnInsert: { generationCount: 0, totalSketches: 0 } },
      { upsert: true }
    );

    const result = await db.collection("agent_state").findOneAndUpdate(
      {
        _id: AGENT_ID,
        $or: [
          { generationLock: { $exists: false } },
          { generationLock: null },
          { "generationLock.expiresAt": { $lt: now.toISOString() } }
        ]
      },
      {
        $set: {
          generationLock: {
            holder: holderId,
            generation,
            phase: "generating",
            progress: null,
            startedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString()
          }
        }
      },
      { returnDocument: "after" }
    );

    return result?.generationLock?.holder === holderId;
  }

  async renewGenerationLock(holderId, { progress, generation } = {}) {
    const db = await this.connect();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + GENERATION_LOCK_TTL_MS);
    const update = { "generationLock.expiresAt": expiresAt.toISOString() };
    if (progress !== undefined) update["generationLock.progress"] = progress;
    if (generation !== undefined) update["generationLock.generation"] = generation;

    const result = await db.collection("agent_state").updateOne(
      { _id: AGENT_ID, "generationLock.holder": holderId },
      { $set: update }
    );
    return result.modifiedCount > 0;
  }

  async releaseGenerationLock(holderId) {
    const db = await this.connect();
    await db.collection("agent_state").updateOne(
      { _id: AGENT_ID, "generationLock.holder": holderId },
      { $unset: { generationLock: "" } }
    );
  }

  async close() {
    if (this.client) await this.client.close();
  }
}