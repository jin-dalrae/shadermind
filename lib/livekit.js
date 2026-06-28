import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";

export const LIVEKIT_AGENT_NAME = process.env.LIVEKIT_AGENT_NAME || "shadermind-curator";

export function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL || "";
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  return {
    enabled: Boolean(url && apiKey && apiSecret),
    url,
    agentName: LIVEKIT_AGENT_NAME
  };
}

export function studioRoomName(generation) {
  const gen = Number(generation) > 0 ? Number(generation) : "live";
  return `shadermind-studio-${gen}`;
}

export async function createParticipantToken({
  room,
  identity = `artist-${Date.now()}`,
  name = "Artist",
  generation = null,
  apiBase = ""
} = {}) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret || !room) {
    throw new Error("LiveKit is not configured.");
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "2h"
  });

  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: LIVEKIT_AGENT_NAME,
        metadata: JSON.stringify({
          generation: generation ?? room,
          apiBase: apiBase || process.env.SHADERMIND_PUBLIC_URL || "http://localhost:8080"
        })
      })
    ]
  });

  return token.toJwt();
}