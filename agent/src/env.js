import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

if (!process.env.MINIMAX_API_KEY && process.env.minimax_api_key) {
  process.env.MINIMAX_API_KEY = process.env.minimax_api_key;
}

if (!process.env.GOOGLE_API_KEY && process.env.GEMINI_API_KEY) {
  process.env.GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
}

export function shaderMindApiBase(metadata = {}) {
  return (
    process.env.SHADERMIND_API_URL
    || metadata.apiBase
    || "http://localhost:8080"
  ).replace(/\/$/, "");
}