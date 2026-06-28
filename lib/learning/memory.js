import { critiqueLabels } from "./critique.js";
import { learningLabels, ratingValue, ratingWeight } from "./features.js";

/** Empty memory keeps old database.json files backward compatible. */
export const EMPTY_PREFERENCE_MEMORY = {
  version: 0,
  updatedAtGeneration: 0,
  prefer: [],
  avoid: []
};

/** Build short preference rules from all rated shader evidence. */
export function buildPreferenceMemory(sketches, previousMemory = EMPTY_PREFERENCE_MEMORY) {
  const evidence = new Map();
  let latestGeneration = previousMemory.updatedAtGeneration || 0;

  for (const sketch of sketches || []) {
    const score = ratingValue(sketch?.rating);
    if (!sketch?.rated || score === null) continue;
    if (sketch.compile?.success === false) continue;

    latestGeneration = Math.max(latestGeneration, Number(sketch.generation) || 0);
    const weight = ratingWeight(sketch.ratingSource);

    for (const label of [...learningLabels(sketch), ...critiqueLabels(sketch)]) {
      const item = evidence.get(label) || { ratingTotal: 0, count: 0 };
      item.ratingTotal += score * weight;
      item.count += weight;
      evidence.set(label, item);
    }
  }

  const ranked = [...evidence.entries()]
    .filter(([label, item]) => {
      const critiqueDerived = label.startsWith("reuse:") || label.startsWith("avoid:");
      return item.count >= (critiqueDerived ? 1 : 1.5);
    })
    .map(([label, item]) => {
      const averageRating = item.ratingTotal / item.count;
      const approval = (averageRating - 1) / 4;
      return {
        rule: humanizeLabel(label),
        support: round(item.count),
        confidence: round(Math.min(1, item.count / 6)),
        approval: round(approval),
        averageRating: round(averageRating)
      };
    });

  const prefer = ranked
    .filter(item => item.averageRating >= 4)
    .sort(sortPreference)
    .slice(0, 8);

  const avoid = ranked
    .filter(item => item.averageRating <= 2)
    .sort(sortPreference)
    .slice(0, 6);

  const changed = JSON.stringify({ prefer, avoid }) !== JSON.stringify({
    prefer: previousMemory.prefer || [],
    avoid: previousMemory.avoid || []
  });

  return {
    version: (previousMemory.version || 0) + (changed ? 1 : 0),
    updatedAtGeneration: latestGeneration,
    prefer,
    avoid
  };
}

/** Format the strongest rules as a small, readable prompt block. */
export function buildPreferenceSummary(memory = EMPTY_PREFERENCE_MEMORY) {
  const prefer = (memory.prefer || []).slice(0, 5);
  const avoid = (memory.avoid || []).slice(0, 3);

  if (!prefer.length && !avoid.length) {
    return "No evidence-backed preference rules yet. Preserve variety and learn from this batch.";
  }

  const lines = [];
  if (prefer.length) {
    lines.push("Observed preferences:");
    prefer.forEach(item => lines.push(`- ${item.rule} (${formatEvidence(item)})`));
  }
  if (avoid.length) {
    lines.push("Avoid when possible:");
    avoid.forEach(item => lines.push(`- ${item.rule} (${formatEvidence(item)})`));
  }
  return lines.join("\n");
}

function sortPreference(a, b) {
  return (b.confidence * Math.abs(b.approval - 0.5))
    - (a.confidence * Math.abs(a.approval - 0.5));
}

function formatEvidence(item) {
  return `${item.averageRating}/5 average, ${item.support} weighted examples`;
}

function humanizeLabel(label) {
  const [group, value] = label.split(":");
  if (group === "reuse") return `Reuse ${value}`;
  if (group === "avoid") return `Avoid ${value}`;

  const prefix = {
    tag: "Use",
    technique: "Use",
    motion: "Favor",
    composition: "Favor",
    palette: "Favor",
    complexity: "Favor"
  }[group] || "Use";
  return `${prefix} ${value}`;
}

function round(value) {
  return Number(value.toFixed(3));
}
