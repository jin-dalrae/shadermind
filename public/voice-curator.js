import {
  Room,
  RoomEvent,
  Track,
  RpcError
} from "https://esm.sh/livekit-client@2.15.4";

export class VoiceCurator {
  constructor(ui) {
    this.ui = ui;
    this.room = null;
    this.enabled = false;
    this.connected = false;
    this.status = "idle";
    this.onStatusChange = null;
  }

  setStatus(status) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  async loadConfig() {
    try {
      const res = await fetch("/api/livekit/config");
      const cfg = await res.json();
      this.enabled = Boolean(cfg.enabled);
      return cfg;
    } catch {
      this.enabled = false;
      return { enabled: false };
    }
  }

  async connect() {
    if (this.connected) return;
    this.setStatus("connecting");

    const tokenRes = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Artist" })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokenData.error || "Could not get LiveKit token");
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    });

    this.registerRpcHandlers(room);

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.id = "shadermind-agent-audio";
        document.body.appendChild(el);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach(el => el.remove());
    });

    room.on(RoomEvent.Disconnected, () => {
      this.connected = false;
      this.setStatus("idle");
      document.getElementById("shadermind-agent-audio")?.remove();
    });

    await room.connect(tokenData.url, tokenData.token);
    await room.localParticipant.setMicrophoneEnabled(true);

    this.room = room;
    this.connected = true;
    this.setStatus("live");
  }

  async disconnect() {
    if (!this.room) return;
    await this.room.disconnect();
    this.room = null;
    this.connected = false;
    this.setStatus("idle");
    document.getElementById("shadermind-agent-audio")?.remove();
  }

  registerRpcHandlers(room) {
    room.registerRpcMethod("rateShader", async (data) => {
      try {
        const params = JSON.parse(data.payload);
        const result = this.ui.applyVoiceRating(params);
        return JSON.stringify(result);
      } catch (err) {
        throw new RpcError(1, err.message || "Could not rate shader");
      }
    });

    room.registerRpcMethod("setOpinion", async (data) => {
      try {
        const params = JSON.parse(data.payload);
        const result = this.ui.applyVoiceOpinion(params.notes || "");
        return JSON.stringify(result);
      } catch (err) {
        throw new RpcError(1, err.message || "Could not save notes");
      }
    });

    room.registerRpcMethod("getCurationProgress", async () => {
      return JSON.stringify(this.ui.getVoiceCurationProgress());
    });

    room.registerRpcMethod("submitCuration", async (data) => {
      try {
        const params = JSON.parse(data.payload);
        if (!params.confirm) {
          throw new RpcError(1, "Submission not confirmed");
        }
        const result = await this.ui.submitVoiceCuration();
        return JSON.stringify(result);
      } catch (err) {
        throw new RpcError(1, err.message || "Could not submit curation");
      }
    });
  }
}