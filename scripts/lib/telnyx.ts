import { wrapTelnyxNetworkError } from "@fambot/messaging";

type TelnyxNumber = {
  phone_number?: string;
  messaging_profile_id?: string | null;
};

export async function telnyxRequest(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(`https://api.telnyx.com/v2${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw wrapTelnyxNetworkError(error);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telnyx ${path} returned ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json() as Promise<Record<string, any>>;
}

export type TelnyxDiscovery = {
  publicKey?: string;
  fromNumber?: string;
  messagingProfileId?: string;
};

export async function discoverTelnyx(args: {
  apiKey: string;
  fromNumber?: string;
  messagingProfileId?: string;
  publicKey?: string;
}): Promise<TelnyxDiscovery> {
  const [keyResponse, numbersResponse] = await Promise.all([
    args.publicKey ? null : telnyxRequest("/public_key", args.apiKey),
    telnyxRequest("/messaging_phone_numbers?page[size]=100", args.apiKey),
  ]);
  const numbers = (numbersResponse.data ?? []) as TelnyxNumber[];
  const candidates = numbers.filter(
    (number) =>
      number.messaging_profile_id &&
      (!args.fromNumber || number.phone_number === args.fromNumber) &&
      (!args.messagingProfileId || number.messaging_profile_id === args.messagingProfileId),
  );

  const publicKey =
    args.publicKey ||
    keyResponse?.data?.public_key ||
    keyResponse?.data?.public ||
    keyResponse?.public_key;
  const fromNumber =
    args.fromNumber || (candidates.length === 1 ? candidates[0]!.phone_number : undefined);
  const selected = numbers.find((number) => number.phone_number === fromNumber);
  const messagingProfileId =
    args.messagingProfileId ||
    selected?.messaging_profile_id ||
    (candidates.length === 1 ? candidates[0]!.messaging_profile_id ?? undefined : undefined);

  if (!fromNumber && candidates.length > 1) {
    throw new Error(
      "Telnyx has multiple configured numbers; set TELNYX_FROM_NUMBER in apps/api/.env and re-run env:setup.",
    );
  }

  return {
    publicKey: typeof publicKey === "string" ? publicKey : undefined,
    fromNumber,
    messagingProfileId: messagingProfileId ?? undefined,
  };
}

export async function registerTelnyxWebhook(args: {
  apiKey: string;
  profileId: string;
  publicUrl: string;
}) {
  const webhookUrl = `${args.publicUrl.replace(/\/$/, "")}/api/webhooks/telnyx`;
  await telnyxRequest(`/messaging_profiles/${args.profileId}`, args.apiKey, {
    method: "PATCH",
    body: JSON.stringify({ webhook_url: webhookUrl, webhook_api_version: "2" }),
  });
  return webhookUrl;
}
