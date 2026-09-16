import { Hono } from "hono";
import { artifactUrl } from "@fambot/shared";
import { env } from "./env";
import { db } from "./context";
import {
  loadArtifactPreview,
  parseArtifactParams,
  renderArtifactOgHtml,
  toPublicPreview,
} from "./artifact-preview";

export const publicArtifacts = new Hono();

publicArtifacts.get("/api/public/artifacts/:type/:id", async (c) => {
  const parsed = parseArtifactParams(c.req.param("type"), c.req.param("id"));
  if (!parsed) return c.json({ error: "not_found" }, 404);
  const record = await loadArtifactPreview(db, parsed.type, parsed.id);
  if (!record) return c.json({ error: "not_found" }, 404);
  return c.json({ artifact: toPublicPreview(record) });
});

publicArtifacts.get("/api/public/artifacts/:type/:id/og", async (c) => {
  const parsed = parseArtifactParams(c.req.param("type"), c.req.param("id"));
  if (!parsed) return c.json({ error: "not_found" }, 404);
  const record = await loadArtifactPreview(db, parsed.type, parsed.id);
  if (!record) return c.json({ error: "not_found" }, 404);
  const preview = toPublicPreview(record);
  const html = renderArtifactOgHtml({
    preview,
    canonicalUrl: artifactUrl(env.APP_URL, parsed.type, parsed.id),
  });
  return c.html(html);
});
