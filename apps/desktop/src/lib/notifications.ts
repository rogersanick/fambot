/**
 * The only module that talks to the Tauri notification plugins.
 *
 * - Official `@tauri-apps/plugin-notification`: permission state + local
 *   notifications (the "send test" button).
 * - Pinned `@spicavi/tauri-plugin-push-notifications`: APNs registration and
 *   foreground/tap events for server-sent pushes.
 *
 * Everything is a no-op outside a Tauri webview, so the same bundle serves
 * the Vercel web app unchanged. APNs tokens rotate, so registration re-runs
 * on every app launch once the user has opted in (see `initNotifications`).
 */
import { api } from "./api";
import { toast } from "sonner";
import { isArtifactType, artifactPath } from "@fambot/shared";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Dev/direct Xcode installs carry the development (sandbox) aps-environment;
 * only App Store Connect exports (`bun ios:build:store`) use production. */
export function apnsEnvironment(): "sandbox" | "production" {
  return import.meta.env.VITE_APNS_ENV === "production" ? "production" : "sandbox";
}

const INSTALLATION_KEY = "fambot-installation-id";
const PUSH_OPTED_IN_KEY = "fambot-push-opted-in";

/** Stable per-install identity so re-registrations upsert instead of piling up. */
export function installationId(): string {
  let id = localStorage.getItem(INSTALLATION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, id);
  }
  return id;
}

export type PushState =
  | "unsupported" // not Tauri, or platform without push (desktop)
  | "prompt" // supported, user has not opted in yet
  | "denied" // user refused the OS permission prompt
  | "registered"; // token registered with the API for this install

/** Ask the OS for the current permission without prompting. */
export async function pushPermissionState(): Promise<PushState> {
  if (!isTauri()) return "unsupported";
  try {
    const push = await import("@spicavi/tauri-plugin-push-notifications");
    const granted = await push.isPermissionGranted();
    if (granted && localStorage.getItem(PUSH_OPTED_IN_KEY) === "1") return "registered";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

/**
 * User-gesture entry point: prompt for permission, register with APNs, and
 * store the device token server-side. Returns the resulting state.
 */
export async function enablePush(householdId: string): Promise<PushState> {
  if (!isTauri()) return "unsupported";
  const push = await import("@spicavi/tauri-plugin-push-notifications");
  const granted = await push.requestPermission();
  if (!granted) return "denied";
  let token: string;
  try {
    token = await push.registerForPush();
  } catch (err) {
    // Desktop, missing aps-environment entitlement, or APNs unreachable.
    console.warn("[push] registration failed:", err);
    return "unsupported";
  }
  await api.pushDevices.register(householdId, {
    installationId: installationId(),
    token,
    platform: "ios",
    environment: apnsEnvironment(),
  });
  localStorage.setItem(PUSH_OPTED_IN_KEY, "1");
  return "registered";
}

/** Deactivate this install's device row and forget the opt-in. */
export async function disablePush(householdId: string): Promise<void> {
  localStorage.removeItem(PUSH_OPTED_IN_KEY);
  await api.pushDevices.unregister(householdId, installationId());
}

/** Local notification (never touches APNs) — verifies OS-level presentation. */
export async function sendLocalTestNotification(): Promise<void> {
  const { isPermissionGranted, requestPermission, sendNotification } = await import(
    "@tauri-apps/plugin-notification"
  );
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) throw new Error("Notification permission was not granted");
  sendNotification({ title: "Fambot", body: "Local notifications are working on this device." });
}

function openArtifactFromPush(data: Record<string, string> | undefined) {
  const type = data?.type;
  const id = data?.id;
  if (!type || !id || !isArtifactType(type)) return;
  window.history.pushState({}, "", artifactPath(type, id));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

let initialized = false;

/**
 * Called once per app boot after a session exists. Re-registers a rotated
 * APNs token when the user previously opted in, and arms foreground/tap
 * listeners. Safe (and a no-op) on web and desktop.
 */
export async function initNotifications(householdId: string): Promise<void> {
  if (!isTauri() || initialized) return;
  initialized = true;
  let push: typeof import("@spicavi/tauri-plugin-push-notifications");
  try {
    push = await import("@spicavi/tauri-plugin-push-notifications");
  } catch {
    return;
  }

  // Foreground pushes: the OS shows nothing, so surface an in-app toast.
  void push.onNotificationReceived((notification) => {
    const text = [notification.title, notification.body].filter(Boolean).join(" — ");
    if (text) {
      toast(text, {
        action:
          notification.data?.type && notification.data.id
            ? { label: "Open", onClick: () => openArtifactFromPush(notification.data) }
            : undefined,
      });
    }
  });
  // Tapped (tray or cold-start): deep-link straight to the artifact.
  void push.onNotificationTapped((notification) => openArtifactFromPush(notification.data));

  // Token rotation: silently refresh the registration on each launch.
  if (localStorage.getItem(PUSH_OPTED_IN_KEY) === "1") {
    try {
      if (await push.isPermissionGranted()) {
        const token = await push.registerForPush();
        await api.pushDevices.register(householdId, {
          installationId: installationId(),
          token,
          platform: "ios",
          environment: apnsEnvironment(),
        });
      }
    } catch (err) {
      console.warn("[push] silent re-registration failed:", err);
    }
  }
}
