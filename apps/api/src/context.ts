import { createDb } from "@fambot/database";
import { createServices } from "@fambot/domain";
import { createAIProvider } from "@fambot/ai";
import { AppChatChannel, ChannelRouter, ImsgChannel } from "@fambot/messaging";
import { env } from "./env";

export const db = createDb(env.DATABASE_URL);
export const services = createServices(db);
export const ai = createAIProvider({
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  OPENAI_MODEL: env.OPENAI_MODEL,
  OPENAI_BASE_URL: env.OPENAI_BASE_URL,
});

/** Set by the bridge websocket module so new outbox rows flush immediately. */
let outboxNotifier: (() => void) | null = null;
export function setOutboxNotifier(fn: () => void) {
  outboxNotifier = fn;
}

export const appChatChannel = new AppChatChannel(db);
export const imsgChannel = new ImsgChannel(db, () => outboxNotifier?.());
export const channelRouter = new ChannelRouter(db, appChatChannel, imsgChannel);
