// Gemini 3.5 Flash REST API client.
// Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// Auth: ?key=API_KEY query param.
//
// Returns: { text, usage: { promptTokens, completionTokens, totalTokens }, latencyMs }

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function callGemini(env, prompt, { temperature = 0.9, maxOutputTokens = 5000, responseMimeType } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const model = env.AI_MODEL || "gemini-3.5-flash";
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens
    }
  };
  if (responseMimeType) {
    body.generationConfig.responseMimeType = responseMimeType;
  }

  const start = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const usage = data?.usageMetadata || {};
  return {
    text,
    usage: {
      promptTokens: usage.promptTokenCount || 0,
      completionTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0
    },
    latencyMs,
    model,
    provider: "gemini"
  };
}
