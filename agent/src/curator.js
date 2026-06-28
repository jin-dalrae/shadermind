import { dedent, getJobContext, inference, llm, voice } from "@livekit/agents";
import { LLM } from "@livekit/agents-plugin-google";
import { z } from "zod";
import { shaderMindApiBase } from "./env.js";

function parseMetadata(ctx) {
  try {
    return JSON.parse(ctx.job?.metadata || "{}");
  } catch {
    return {};
  }
}

async function fetchShaderMind(path, metadata) {
  const base = shaderMindApiBase(metadata);
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new llm.ToolError(`ShaderMind API error ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

function artistParticipant(room) {
  const remote = [...room.remoteParticipants.values()];
  return remote.find(p => !p.identity.startsWith("agent")) || remote[0];
}

async function rpcToArtist(method, payload) {
  const room = getJobContext().room;
  const artist = artistParticipant(room);
  if (!artist) {
    throw new llm.ToolError("The artist is not connected to the voice room.");
  }

  const response = await room.localParticipant.performRpc({
    destinationIdentity: artist.identity,
    method,
    payload: JSON.stringify(payload),
    responseTimeout: 15000
  });

  return JSON.parse(response);
}

const getBatchStatus = llm.tool({
  description: dedent`
    Read the current ShaderMind studio state: generation number, autopilot phase,
    and the list of shaders in the active batch with titles and hypotheses.
  `,
  parameters: z.object({}),
  execute: async (_args, { ctx }) => {
    const metadata = parseMetadata(ctx);
    const status = await fetchShaderMind("/api/autopilot/status", metadata);
    const batch = (status.currentBatch || []).map((sketch, index) => ({
      index: index + 1,
      id: sketch.id,
      title: sketch.title,
      type: sketch.type,
      hypothesis: sketch.hypothesis || null
    }));

    return {
      phase: status.phase,
      awaitingHuman: status.awaitingHuman,
      generation: status.currentGeneration,
      batch,
      generationProgress: status.generationProgress || null
    };
  }
});

const rateShader = llm.tool({
  description: dedent`
    Rate one shader in the current batch from 1 to 5. Use the shader index (1-based,
    left-to-right in the grid) or the sketch id. Updates the artist's studio UI.
  `,
  parameters: z.object({
    index: z.number().int().min(1).max(20).optional().describe("1-based position in the grid"),
    sketchId: z.string().optional().describe("Sketch id such as sketch-gen11-3"),
    rating: z.number().int().min(1).max(5)
  }),
  execute: async ({ index, sketchId, rating }) => {
    if (!index && !sketchId) {
      throw new llm.ToolError("Provide either index or sketchId.");
    }
    return rpcToArtist("rateShader", { index, sketchId, rating });
  }
});

const setCurationNotes = llm.tool({
  description: dedent`
    Save the artist's free-form taste notes for this batch (motion, color, mood, etc.).
    These notes are submitted with ratings when curation is finalized.
  `,
  parameters: z.object({
    notes: z.string().min(1).max(2000)
  }),
  execute: async ({ notes }) => rpcToArtist("setOpinion", { notes })
});

const getCurationProgress = llm.tool({
  description: "Check how many shaders in the current batch have been rated so far.",
  parameters: z.object({}),
  execute: async () => rpcToArtist("getCurationProgress", {})
});

const submitCuration = llm.tool({
  description: dedent`
    Submit all ratings and notes to ShaderMind and release the autopilot for the next batch.
    Only call this after every shader has a rating from 1 to 5.
  `,
  parameters: z.object({
    confirm: z.boolean().describe("Must be true to submit")
  }),
  execute: async ({ confirm }) => {
    if (!confirm) {
      throw new llm.ToolError("Submission requires confirm=true.");
    }
    return rpcToArtist("submitCuration", { confirm: true });
  }
});

export class CuratorAgent extends voice.Agent {
  constructor() {
    super({
      instructions: dedent`
        You are ShaderMind's voice curator — a calm, expert studio assistant helping an artist
        rate GLSL shader sketches and steer the learning agent's taste.

        The artist sees a grid of animated shaders. They rate each one 1 to 5, then submit to
        teach the agent. One is low, five is high.

        Your job:
        - Greet the artist and explain you can discuss the batch, record ratings, capture notes,
          and submit when ready.
        - Use get_batch_status to learn what is on screen before giving advice.
        - When the artist names a shader by position ("the first one", "number three") or title,
          use rate_shader with the correct index.
        - Capture taste notes with set_curation_notes when they describe what they want more or less of.
        - Use get_curation_progress before submit_curation to ensure every shader is rated.
        - Only submit when they explicitly ask to finish or move to the next batch.

        Voice rules:
        - Plain spoken English only. No markdown, lists, emojis, or code.
        - Keep replies short: one to three sentences unless the artist asks for detail.
        - Say shader titles naturally; spell out numbers when helpful.
        - Do not mention tool names or internal APIs.
      `,
      llm: new LLM({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash"
      }),
      tools: {
        getBatchStatus,
        rateShader,
        setCurationNotes,
        getCurationProgress,
        submitCuration
      }
    });
  }
}

export function createCuratorSession({ tts }) {
  return new voice.AgentSession({
    stt: new inference.STT({
      model: process.env.LIVEKIT_STT_MODEL || "deepgram/nova-3",
      language: "en"
    }),
    tts,
    turnHandling: {
      turnDetection: new inference.TurnDetector(),
      preemptiveGeneration: { enabled: true }
    }
  });
}