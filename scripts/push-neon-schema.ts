/**
 * Push the Drizzle schema to the remote Neon database.
 *
 * Resolves an unpooled connection string via neonctl (DDL cannot go through
 * the pooler), then runs `drizzle-kit push`.
 *
 *   bun run db:push:neon
 *   bun run db:push:neon -- --project fambot --branch main
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  describePostgresUrl,
  neonConnectionString,
  resolveNeonProject,
} from "./lib/neon";

const root = resolve(import.meta.dir, "..");

type Args = {
  projectId?: string;
  project?: string;
  branch?: string;
  dryRun: boolean;
  drizzleArgs: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, drizzleArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith("-")) fail(`Missing value for ${token}`);
      return value;
    };
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    if (flag === "--project-id") args.projectId = inline ?? next();
    else if (flag === "--project") args.project = inline ?? next();
    else if (flag === "--branch") args.branch = inline ?? next();
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--") args.drizzleArgs.push(...argv.slice(i + 1)), (i = argv.length);
    else if (token.startsWith("-")) args.drizzleArgs.push(token);
    else args.drizzleArgs.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.projectId) args.projectId = process.env.NEON_PROJECT_ID;
if (!args.project) args.project = process.env.NEON_PROJECT;
if (!args.branch) args.branch = process.env.NEON_BRANCH;

const project = resolveNeonProject({ projectId: args.projectId, project: args.project });
console.log(
  `[neon] project ${project.name} (${project.id})` +
    (args.branch ? ` branch ${args.branch}` : " (default branch)"),
);

const databaseUrl = neonConnectionString({
  projectId: project.id,
  branch: args.branch,
  pooled: false,
});
console.log(`[neon] ${describePostgresUrl(databaseUrl)}`);

if (args.dryRun) {
  console.log("[neon] dry run — skipping drizzle-kit push");
  process.exit(0);
}

const push = spawnSync("bun", ["run", "push", ...args.drizzleArgs], {
  cwd: resolve(root, "packages/database"),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: "inherit",
});
if (push.error) throw push.error;
if (push.status !== 0) process.exit(push.status ?? 1);
console.log("[neon] schema push complete");
