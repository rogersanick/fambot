import type { ContextTurn } from "./context-buffer.js";

export interface IngestPayload {
  message_guid: string;
  chat_guid: string;
  sender_handle: string;
  sender_name: string | null;
  message_text: string;
  sent_at: string;
  is_from_me: boolean;
  context_turns: ContextTurn[];
  chat_participants?: { address: string; displayName: string | null }[];
}

export interface OutboxMessage {
  id: string;
  chat_guid: string;
  message_type: string;
  message_text: string;
}

export interface HeartbeatResponse {
  invocation_map: Record<string, string>;
}

/** Bearer-secret client for the four FamBot edge functions. */
export class FambotApi {
  constructor(
    private readonly functionsUrl: string,
    private readonly bridgeId: string,
    private readonly bridgeSecret: string,
  ) {}

  private async post<T>(fn: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.functionsUrl}/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fambot-Bridge-ID": this.bridgeId,
        Authorization: `Bearer ${this.bridgeSecret}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${fn} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  ingestMessage(payload: IngestPayload): Promise<{ status: string }> {
    return this.post("ingest-message", payload);
  }

  pullOutbox(batchSize = 10): Promise<{ messages: OutboxMessage[] }> {
    return this.post("pull-outbox", { batch_size: batchSize, lease_seconds: 60 });
  }

  acknowledgeOutbox(
    results: { id: string; status: "sent" | "failed"; error?: string }[],
  ): Promise<{ status: string }> {
    return this.post("acknowledge-outbox", { results });
  }

  heartbeat(meta: {
    worker_version: string;
    macos_version?: string;
  }): Promise<HeartbeatResponse> {
    return this.post("bridge-heartbeat", meta);
  }
}
