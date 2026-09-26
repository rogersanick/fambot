import { createDb } from "@fambot/database";
import { createServices } from "@fambot/domain";
import { createAIRuntime } from "@fambot/ai";
import {
  ApnsClient,
  AppChatChannel,
  ChannelRouter,
  ImsgChannel,
  NotificationDispatcher,
  TelnyxSmsChannel,
} from "@fambot/messaging";
import { apnsEnabled, env, telnyxEnabled } from "./env";

export const db = createDb(env.DATABASE_URL);
export const services = createServices(db);
export const ai = createAIRuntime({
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
export const telnyxChannel = telnyxEnabled
  ? new TelnyxSmsChannel(db, {
      apiKey: env.TELNYX_API_KEY!,
      fromNumber: env.TELNYX_FROM_NUMBER!,
      messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID,
    })
  : null;
export const channelRouter = new ChannelRouter(db, appChatChannel, imsgChannel, telnyxChannel);

/** APNs sender — used by the worker's twin config and the API's test push. */
export const apnsClient = apnsEnabled
  ? new ApnsClient({
      teamId: env.APNS_TEAM_ID!,
      keyId: env.APNS_KEY_ID!,
      bundleId: env.APNS_BUNDLE_ID!,
      privateKey: env.APNS_PRIVATE_KEY!,
    })
  : null;

/** Broadcast dispatcher for scheduled notifications (worker + API share it). */
export const notificationDispatcher = new NotificationDispatcher(db, {
  telnyx: telnyxChannel,
  apns: apnsClient,
  notifyImsgOutbox: () => outboxNotifier?.(),
});
