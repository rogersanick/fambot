const UNFURL_BOT =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|LinkedInBot|WhatsApp|Applebot|Googlebot|bingbot|Discordbot|TelegramBot|SkypeUriPreview|Iframely/i;

export const config = {
  matcher: ["/(task|reminder|list|event)/:id"],
};

export default async function middleware(request) {
  const ua = request.headers.get("user-agent") ?? "";
  if (!UNFURL_BOT.test(ua)) return;

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/(task|reminder|list|event)\/([0-9a-f-]{36})$/i);
  if (!match) return;

  const api = process.env.API_BASE_URL || process.env.VITE_API_URL;
  if (!api) return;

  const dest = `${api.replace(/\/$/, "")}/api/public/artifacts/${match[1].toLowerCase()}/${match[2]}/og`;
  return fetch(dest);
}
