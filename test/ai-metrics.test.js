import test from "node:test";
import assert from "node:assert/strict";
import { _recordInferenceCall, clearInferenceCalls, getInferenceCalls, getInferenceMetrics } from "../lib/ai.js";

const SYNTHETIC_DEFAULTS = {
  task: "glsl",
  provider: "digitalocean",
  model: "claude-opus-4.8",
  label: "synthetic",
  attempt: 0,
  latencyMs: 1000,
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  success: true,
  error: null
};

function recordSynthetic(opts = {}) {
  _recordInferenceCall({ ...SYNTHETIC_DEFAULTS, ...opts, timestamp: opts.timestamp || new Date().toISOString() });
}

test("getInferenceMetrics returns zeros on a fresh buffer", () => {
  clearInferenceCalls();
  const m = getInferenceMetrics();
  assert.equal(m.cap > 0, true);
  assert.equal(m.bufferSize, 0);
  assert.equal(m.filter.task, null);
  assert.equal(m.filter.since, null);
  assert.equal(m.totals.calls, 0);
  assert.equal(m.totals.successes, 0);
  assert.equal(m.totals.errors, 0);
  assert.equal(m.totals.totalTokens, 0);
  assert.equal(m.totals.promptTokens, 0);
  assert.equal(m.totals.completionTokens, 0);
  assert.equal(m.totals.avgLatencyMs, 0);
  assert.equal(m.totals.p50LatencyMs, null);
  assert.equal(m.totals.p95LatencyMs, null);
  assert.deepEqual(m.byTask, {});
  assert.deepEqual(m.byModel, {});
  assert.deepEqual(m.recent, []);
});

test("clearInferenceCalls returns dropped count and empties buffer", () => {
  clearInferenceCalls();
  recordSynthetic();
  recordSynthetic({ task: "planning" });
  assert.equal(getInferenceCalls().length, 2);
  const dropped = clearInferenceCalls();
  assert.equal(dropped, 2);
  assert.equal(getInferenceCalls().length, 0);
});

test("getInferenceMetrics aggregates totals across tasks", () => {
  clearInferenceCalls();
  recordSynthetic({ task: "glsl", latencyMs: 1000, usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 } });
  recordSynthetic({ task: "glsl", latencyMs: 2000, usage: { promptTokens: 250, completionTokens: 150, totalTokens: 400 } });
  recordSynthetic({ task: "evolution", latencyMs: 500, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
  recordSynthetic({ task: "evolution", latencyMs: null, usage: null, success: false, error: "timeout" });

  const m = getInferenceMetrics();
  assert.equal(m.totals.calls, 4);
  assert.equal(m.totals.successes, 3);
  assert.equal(m.totals.errors, 1);
  assert.equal(m.totals.totalTokens, 850);
  assert.equal(m.totals.promptTokens, 550);
  assert.equal(m.totals.completionTokens, 300);
  assert.equal(m.totals.latencySamples, 3);
  assert.equal(m.totals.avgLatencyMs, 1167);
  assert.ok(m.totals.p50LatencyMs !== null);
  assert.ok(m.totals.p95LatencyMs !== null);
});

test("getInferenceMetrics computes byTask breakdown", () => {
  clearInferenceCalls();
  recordSynthetic({ task: "glsl", latencyMs: 1000, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
  recordSynthetic({ task: "glsl", latencyMs: 2000, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
  recordSynthetic({ task: "evolution", latencyMs: 500, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });

  const m = getInferenceMetrics();
  assert.equal(m.byTask.glsl.calls, 2);
  assert.equal(m.byTask.glsl.totalTokens, 300);
  assert.equal(m.byTask.glsl.avgLatencyMs, 1500);
  assert.equal(m.byTask.evolution.calls, 1);
  assert.equal(m.byTask.evolution.avgLatencyMs, 500);
  assert.equal(m.byTask.narrative, undefined);
});

test("getInferenceMetrics computes byModel breakdown", () => {
  clearInferenceCalls();
  recordSynthetic({ model: "claude-opus-4.8", latencyMs: 1000 });
  recordSynthetic({ model: "claude-opus-4.8", latencyMs: 2000 });
  recordSynthetic({ model: "gemini-3.5-flash", provider: "gemini", latencyMs: 500 });

  const m = getInferenceMetrics();
  assert.equal(m.byModel["claude-opus-4.8"].calls, 2);
  assert.equal(m.byModel["claude-opus-4.8"].avgLatencyMs, 1500);
  assert.equal(m.byModel["gemini-3.5-flash"].calls, 1);
  assert.equal(m.byModel["gemini-3.5-flash"].avgLatencyMs, 500);
});

test("getInferenceMetrics filters by task", () => {
  clearInferenceCalls();
  recordSynthetic({ task: "glsl" });
  recordSynthetic({ task: "planning" });
  recordSynthetic({ task: "evolution" });

  const m = getInferenceMetrics({ task: "glsl" });
  assert.equal(m.totals.calls, 1);
  assert.equal(m.filter.task, "glsl");
  assert.equal(m.recent[0].task, "glsl");
});

test("getInferenceMetrics filters by since timestamp", () => {
  clearInferenceCalls();
  const t1 = "2026-01-01T00:00:00.000Z";
  const t2 = "2026-06-15T00:00:00.000Z";
  const t3 = "2026-12-01T00:00:00.000Z";
  recordSynthetic({ timestamp: t1 });
  recordSynthetic({ timestamp: t2 });
  recordSynthetic({ timestamp: t3 });

  const m = getInferenceMetrics({ since: "2026-06-01T00:00:00.000Z" });
  assert.equal(m.totals.calls, 2);
  assert.equal(m.filter.since, "2026-06-01T00:00:00.000Z");
});

test("getInferenceMetrics.recent returns the last 20 entries in reverse order", () => {
  clearInferenceCalls();
  for (let i = 0; i < 25; i += 1) {
    recordSynthetic({ task: "glsl", label: `call-${i}`, timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString() });
  }
  const m = getInferenceMetrics();
  assert.equal(m.recent.length, 20);
  assert.equal(m.recent[0].label, "call-24");
  assert.equal(m.recent[19].label, "call-5");
});

test("getInferenceMetrics handles null usage gracefully", () => {
  clearInferenceCalls();
  recordSynthetic({ usage: null, latencyMs: 1000 });
  const m = getInferenceMetrics();
  assert.equal(m.totals.calls, 1);
  assert.equal(m.totals.totalTokens, 0);
  assert.equal(m.totals.latencySamples, 1);
  assert.equal(m.totals.avgLatencyMs, 1000);
});

test("getInferenceMetrics handles failed calls (no latency, no usage)", () => {
  clearInferenceCalls();
  recordSynthetic({ success: false, error: "rate limit", latencyMs: null, usage: null });
  const m = getInferenceMetrics();
  assert.equal(m.totals.calls, 1);
  assert.equal(m.totals.errors, 1);
  assert.equal(m.totals.successes, 0);
  assert.equal(m.totals.latencySamples, 0);
  assert.equal(m.totals.avgLatencyMs, 0);
});

test("ring buffer caps at INFERENCE_LOG_CAP (env-configurable)", async () => {
  const prev = process.env.INFERENCE_LOG_CAP;
  process.env.INFERENCE_LOG_CAP = "5";
  try {
    const fresh = await import(`../lib/ai.js?cap-test-${Date.now()}`);
    fresh.clearInferenceCalls();
    for (let i = 0; i < 12; i += 1) {
      fresh._recordInferenceCall({
        task: "glsl",
        provider: "digitalocean",
        model: "claude-opus-4.8",
        label: `cap-${i}`,
        attempt: 0,
        latencyMs: 100,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        success: true,
        error: null,
        timestamp: new Date().toISOString()
      });
    }
    const calls = fresh.getInferenceCalls();
    assert.equal(calls.length, 5, `buffer should cap at 5, got ${calls.length}`);
    assert.equal(calls[0].label, "cap-7", "oldest entries should be evicted");
    assert.equal(calls[4].label, "cap-11");
  } finally {
    if (prev === undefined) delete process.env.INFERENCE_LOG_CAP;
    else process.env.INFERENCE_LOG_CAP = prev;
  }
});

test("getInferenceMetrics.percentile computes reasonable p50 and p95", () => {
  clearInferenceCalls();
  for (let i = 1; i <= 100; i += 1) {
    recordSynthetic({ latencyMs: i * 10 });
  }
  const m = getInferenceMetrics();
  assert.ok(m.totals.p50LatencyMs >= 500 && m.totals.p50LatencyMs <= 600, `p50 should be ~500, got ${m.totals.p50LatencyMs}`);
  assert.ok(m.totals.p95LatencyMs >= 900 && m.totals.p95LatencyMs <= 1000, `p95 should be ~950, got ${m.totals.p95LatencyMs}`);
});

test("LOG_INFERENCE=true logs each call to stdout", () => {
  clearInferenceCalls();
  const prev = process.env.LOG_INFERENCE;
  process.env.LOG_INFERENCE = "true";
  try {
    const logs = [];
    const originalLog = console.log;
    console.log = (msg) => logs.push(String(msg));
    try {
      _recordInferenceCall({
        task: "glsl",
        provider: "digitalocean",
        model: "claude-opus-4.8",
        label: "test-call",
        attempt: 0,
        latencyMs: 1234,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        success: true,
        error: null,
        timestamp: new Date().toISOString()
      });
    } finally {
      console.log = originalLog;
    }
    const inferenceLogs = logs.filter((l) => l.startsWith("[inference]"));
    assert.equal(inferenceLogs.length, 1);
    assert.ok(inferenceLogs[0].includes("task=glsl"));
    assert.ok(inferenceLogs[0].includes("model=claude-opus-4.8"));
    assert.ok(inferenceLogs[0].includes("latency=1234ms"));
    assert.ok(inferenceLogs[0].includes("tokens=150"));
    assert.ok(inferenceLogs[0].includes("label=test-call"));
  } finally {
    if (prev === undefined) delete process.env.LOG_INFERENCE;
    else process.env.LOG_INFERENCE = prev;
  }
});

test("LOG_INFERENCE=false (default) does not emit per-call log lines", () => {
  clearInferenceCalls();
  const prev = process.env.LOG_INFERENCE;
  process.env.LOG_INFERENCE = "false";
  try {
    const logs = [];
    const originalLog = console.log;
    console.log = (msg) => logs.push(String(msg));
    try {
      _recordInferenceCall({
        task: "glsl",
        provider: "digitalocean",
        model: "claude-opus-4.8",
        label: "silent-call",
        attempt: 0,
        latencyMs: 1234,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        success: true,
        error: null,
        timestamp: new Date().toISOString()
      });
    } finally {
      console.log = originalLog;
    }
    const inferenceLogs = logs.filter((l) => l.startsWith("[inference]"));
    assert.equal(inferenceLogs.length, 0, "LOG_INFERENCE=false should suppress per-call logging");
  } finally {
    if (prev === undefined) delete process.env.LOG_INFERENCE;
    else process.env.LOG_INFERENCE = prev;
  }
});

test("getInferenceMetrics total tokens sum across all entries", () => {
  clearInferenceCalls();
  recordSynthetic({ usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
  recordSynthetic({ usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 } });
  recordSynthetic({ usage: null });
  const m = getInferenceMetrics();
  assert.equal(m.totals.totalTokens, 450);
  assert.equal(m.totals.promptTokens, 300);
  assert.equal(m.totals.completionTokens, 150);
});

test("server.js exposes /api/inference/metrics endpoint with task and since query params", async () => {
  const fs = await import("fs");
  const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.ok(/app\.get\("\/api\/inference\/metrics"/.test(src), "server.js should register GET /api/inference/metrics");
  assert.ok(/app\.post\("\/api\/inference\/clear"/.test(src), "server.js should register POST /api/inference/clear");
  assert.ok(/getInferenceMetrics\(\{ task, since \}\)/.test(src), "endpoint should forward task + since to getInferenceMetrics");
});