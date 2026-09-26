import type { ImsgMessage } from "./imsg-rpc";
import type { BridgeState } from "./state";
import type { BridgeConfig } from "./config";

function messagePreview(text: string | undefined): string {
  if (!text) return "<no text>";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return JSON.stringify(oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine);
}

export function formatBotMessage(prefix: string, text: string): string {
  // Keep the prefix configurable, but normalize the old decorated default so
  // existing .env files do not produce a doubled colon or duplicate emoji.
  const header =
    prefix.trim().replace(/:\s*🤖✨\s*$/, "") || "Fambot says";
  return `${header}: 🤖✨
━━━━━━━━━━━━━━━━━━━━
${text.trim()}`;
}

/**
 * Inbound relay: forwards every relevant iMessage to the API's ingest
 * endpoint. Ordered per-process queue with retry/backoff — the API dedupes by
 * message GUID, so retries are safe.
 */
export class InboundRelay {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private config: BridgeConfig,
    private state: BridgeState,
    private fetchFn: typeof fetch = fetch,
    private log: (message: string) => void = console.log
  ) {}

  handle(msg: ImsgMessage): void {
    this.log(
      `[relay] iMessage received rowid=${msg.id} guid=${msg.guid ?? "unknown"} chat=${msg.chat_guid ?? "unknown"} sender=${msg.sender ?? "unknown"} fromMe=${Boolean(msg.is_from_me)} text=${messagePreview(msg.text)}`
    );
    const text = msg.text?.trim();
    if (!text) {
      this.log(`[relay] skipped rowid=${msg.id}: no text (attachment or reaction)`);
      return;
    }
    if (!msg.chat_guid || !msg.guid) {
      this.log(`[relay] skipped rowid=${msg.id}: missing chat GUID or message GUID`);
      return;
    }

    if (text.startsWith(this.config.BOT_MESSAGE_PREFIX) || this.state.wasSentByUs(msg.guid)) {
      this.log(`[relay] skipped guid=${msg.guid}: bridge echo`);
      return;
    }

    const payload = {
      guid: msg.guid,
      chatGuid: msg.chat_guid,
      text,
      senderHandle: msg.sender ?? "unknown",
      senderName: msg.sender_name,
      senderMemberId: msg.is_from_me ? this.config.BRIDGE_MEMBER_ID : undefined,
      isGroup: msg.chat_guid.includes(";+;"),
      sentAt: msg.created_at ? new Date(msg.created_at).toISOString() : new Date().toISOString(),
    };

    this.log(`[relay] forwarding guid=${msg.guid} to API`);
    this.queue = this.queue.then(() => this.post(payload));
  }

  private async post(payload: { guid: string }, attempt = 0): Promise<void> {
    try {
      const res = await this.fetchFn(`${this.config.API_URL}/api/ingest/imessage`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.BRIDGE_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok && res.status >= 500) throw new Error(`ingest ${res.status}`);
      const responseText = await res.text();
      if (!res.ok) {
        console.error(`[relay] ingest rejected guid=${payload.guid} (${res.status}):`, responseText);
        return;
      }
      let result: { routed?: boolean; invoked?: boolean } = {};
      try {
        result = JSON.parse(responseText) as typeof result;
      } catch {
        // A successful response without JSON is still accepted.
      }
      this.log(
        `[relay] ingest accepted guid=${payload.guid} routed=${Boolean(result.routed)} invoked=${Boolean(result.invoked)}`
      );
    } catch (err) {
      if (attempt < 5) {
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        console.error(`[relay] ingest failed (retry in ${delay}ms):`, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, delay));
        return this.post(payload, attempt + 1);
      }
      console.error("[relay] ingest permanently failed, dropping message");
    }
  }
}

/**
 * Outbound consumer: WebSocket to the API; executes "send" commands through
 * imsg and acks with the resulting message GUID. Reconnects with backoff.
 */
export class OutboundConsumer {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoff = 1000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: BridgeConfig,
    private state: BridgeState,
    private sendImsg: (args: { chat_guid: string; text: string }) => Promise<{ guid?: string }>
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const url = `${this.config.API_URL.replace(/^http/, "ws")}/api/bridge/ws?token=${encodeURIComponent(this.config.BRIDGE_TOKEN)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      console.log("[relay] outbound websocket connected");
      this.backoff = 1000;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 30_000);
    };

    ws.onmessage = (evt) => {
      void this.handleCommand(String(evt.data));
    };

    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.stopped) return;
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, 30_000);
      console.error(`[relay] websocket closed, reconnecting in ${delay}ms`);
      setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => {
      // onclose fires next; nothing to do here
    };
  }

  private async handleCommand(raw: string): Promise<void> {
    let cmd: { type?: string; id?: string; chatGuid?: string; text?: string };
    try {
      cmd = JSON.parse(raw);
    } catch {
      return;
    }
    if (cmd.type !== "send" || !cmd.id || !cmd.chatGuid || !cmd.text) return;
    try {
      console.log(
        `[relay] outbound received id=${cmd.id} chat=${cmd.chatGuid} text=${messagePreview(cmd.text)}`
      );
      const body = formatBotMessage(this.config.BOT_MESSAGE_PREFIX, cmd.text);
      const result = await this.sendImsg({ chat_guid: cmd.chatGuid, text: body });
      this.state.recordSent(result.guid);
      console.log(`[relay] outbound sent id=${cmd.id} guid=${result.guid ?? "unknown"}`);
      this.ws?.send(JSON.stringify({ type: "ack", id: cmd.id, ok: true, externalMessageId: result.guid }));
    } catch (err) {
      console.error(`[relay] outbound failed id=${cmd.id}:`, err instanceof Error ? err.message : err);
      this.ws?.send(
        JSON.stringify({
          type: "ack",
          id: cmd.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
}
