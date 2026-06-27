# Hackathon Participant Guide: 2026 AI Engineer World's Fair

This guide tracks our compliance with the hackathon criteria and rules, specifically targeting the **Continual Learning** theme and the **Google Gemini Special Prize**.

---

## 1. Hackathon Themes (The Core Themes)
Every project must align with one of these three themes. ShaderMind is explicitly engineered to win:

* **Continual Learning (Our Target Theme):** 
  * *Prompt:* "How can LLM systems continuously improve from real-world use? Build agents, harnesses, or frameworks that allow continual learning through memory, user feedback, prompt optimization, self-reflection, toolkit expansion, or other methods. Focus on techniques that adapt in production, becoming more useful the more they are used with as little user intervention as possible."
  * *ShaderMind Implementation:* The agent evaluates its own GLSL outputs, records textual self-reflections, updates its instruction genome string based on user good/bad curation, and seeds previous successes back into the generation pool to achieve genetic code-remixing.

---

## 2. Prize Categories & Focus

* **Special Prize: Best Usage of Gemini API ($5,000 Cash Prize):**
  * *Strategy:* Bypasses generic models to utilize official Google Gemini API (using standard JSON-mode outputs for rapid execution). The entire user experience highlights how Gemini serves as an autonomous, self-evaluating programmer and creative companion.
* **Special Prize: Best Use of DigitalOcean:**
  * *Strategy:* The application runs as a standard lightweight Node.js Express server on port `8080`, easily deployable via Docker, App Platform, or droplet to DigitalOcean.

---

## 3. Strict Rules & Guardrails
* **No "Standard Wrapper" Apps:** Basic prompt-to-image or prompt-to-text chatbots are strictly penalized. ShaderMind is a **stateful, adaptive, multi-agent WebGL compiling playground**—which is highly dynamic and visual.
* **Demo Video Constraints:** Needs a highly concise 60-second video displaying actual real-time interaction, human-in-the-loop curation, the agent's textual self-reflections, and the resulting generation change.
* **Repository Readiness:** The code must be cleanly isolated and public on GitHub. No extraneous build files, draft PDFs, or local credentials can exist in the workspace directory.
