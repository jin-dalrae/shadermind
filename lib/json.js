export function stripMarkdownFences(text) {
  let jsonString = text.trim();
  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.substring(7);
  } else if (jsonString.startsWith("```")) {
    jsonString = jsonString.substring(3);
  }
  if (jsonString.endsWith("```")) {
    jsonString = jsonString.substring(0, jsonString.length - 3);
  }
  return jsonString.trim();
}

export function parseJsonFromModel(rawResponse) {
  const candidates = [
    stripMarkdownFences(rawResponse),
    rawResponse.trim()
  ];

  const arrayMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);

  const objectMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Unable to parse model JSON response.");
}