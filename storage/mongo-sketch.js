/** Round-trip sketch documents for MongoDB ↔ continual-learning engine. */

export function normalizeSketchDoc(doc) {
  if (!doc) return null;

  const sketch = {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    hypothesis: doc.hypothesis,
    glsl: doc.glsl,
    poetic_statement: doc.poetic_statement ?? "",
    generation: doc.generation,
    rated: Boolean(doc.rated),
    rating: doc.rating ?? null,
    dna: doc.dna ?? [],
    thumbnail: doc.thumbnail ?? null,
    thumbnailVersion: doc.thumbnailVersion ?? 0,
    curatorSource: doc.curatorSource ?? null,
    ratingSource: doc.ratingSource ?? null,
    generationFocus: doc.generationFocus ?? null,
    prompt: doc.prompt ?? null,
    patternIds: doc.patternIds ?? null,
    learningUseCount: doc.learningUseCount ?? 0,
    similarityWarning: doc.similarityWarning ?? null
  };

  if (doc.compile && typeof doc.compile === "object") {
    sketch.compile = {
      success: doc.compile.success ?? null,
      error: doc.compile.error ?? null,
      reportedAt: doc.compile.reportedAt ?? null
    };
  }

  if (doc.critique && typeof doc.critique === "object") {
    sketch.critique = {
      strengths: Array.isArray(doc.critique.strengths) ? doc.critique.strengths : [],
      weaknesses: Array.isArray(doc.critique.weaknesses) ? doc.critique.weaknesses : [],
      reusablePatterns: Array.isArray(doc.critique.reusablePatterns) ? doc.critique.reusablePatterns : [],
      avoidPatterns: Array.isArray(doc.critique.avoidPatterns) ? doc.critique.avoidPatterns : []
    };
  }

  if (doc.codeFeatures && typeof doc.codeFeatures === "object") {
    sketch.codeFeatures = doc.codeFeatures;
  }

  if (doc.learningContext && typeof doc.learningContext === "object") {
    sketch.learningContext = doc.learningContext;
  }

  return sketch;
}

export function sketchFieldsForMongo(sketch) {
  const normalized = normalizeSketchDoc(sketch);
  if (!normalized) return null;
  return {
    ...normalized,
    createdAt: sketch.createdAt || new Date()
  };
}