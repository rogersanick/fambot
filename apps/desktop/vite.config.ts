import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const UNFURL_BOT =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|LinkedInBot|WhatsApp|Applebot|Googlebot|bingbot|Discordbot|TelegramBot|SkypeUriPreview|Iframely/i;

/** Serve Open Graph HTML to crawlers so iMessage/SMS can unfurl artifact URLs. */
function artifactOgPlugin(): Plugin {
  return {
    name: "fambot-artifact-og",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const ua = req.headers["user-agent"] ?? "";
        if (!UNFURL_BOT.test(String(ua))) {
          next();
          return;
        }
        const pathname = (req.url ?? "").split("?")[0] ?? "";
        const match = pathname.match(/^\/(task|reminder|list|event)\/([0-9a-f-]{36})$/i);
        if (!match) {
          next();
          return;
        }
        const dest = `http://localhost:8787/api/public/artifacts/${match[1]!.toLowerCase()}/${match[2]}/og`;
        void fetch(dest)
          .then(async (og) => {
            const html = await og.text();
            res.statusCode = og.status;
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(html);
          })
          .catch(() => next());
      });
    },
  };
}

// Same codebase serves: Tauri webview (desktop + iOS) and a plain SPA (Vercel).
// In dev, /api is proxied to the local Hono API so auth cookies are
// first-party. Physical iPhone builds set TAURI_DEV_HOST so the simulator
// or device can reach this machine on the LAN.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [artifactOgPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  clearScreen: false,
});
