import "./env.js";
import { ServerOptions, cli, defineAgent } from "@livekit/agents";
import { TTS } from "@livekit/agents-plugin-minimax";
import { fileURLToPath } from "node:url";
import { CuratorAgent, createCuratorSession } from "./curator.js";

const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME || "shadermind-curator";

export default defineAgent({
  entry: async (ctx) => {
    const tts = new TTS({
      model: process.env.MINIMAX_TTS_MODEL || "speech-02-turbo",
      voice: process.env.MINIMAX_VOICE_ID || undefined
    });

    const session = createCuratorSession({ tts });

    await session.start({
      agent: new CuratorAgent(),
      room: ctx.room
    });

    await ctx.connect();

    session.generateReply({
      instructions: dedentGreeting(ctx.job?.metadata)
    });
  }
});

function dedentGreeting(metadataRaw) {
  let generation = null;
  try {
    const meta = JSON.parse(metadataRaw || "{}");
    generation = meta.generation ?? null;
  } catch {
    // ignore
  }

  const genLine = generation
    ? `They are curating generation ${generation}.`
    : "They are in the ShaderMind studio.";

  return `Greet the artist warmly. You are ShaderMind's voice curator. ${genLine} Offer to walk through the batch, record ratings from one to five, capture taste notes, and submit when they are ready for the next batch. Keep it to two short sentences.`;
}

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: AGENT_NAME
  })
);