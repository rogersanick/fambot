import { spawnSync } from "node:child_process";

const DEFAULT_PROJECT_NAME = "fambot";

export type NeonProject = { id: string; name: string };

function fail(message: string): never {
  throw new Error(message);
}

export function commandExists(command: string) {
  return spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command]).status === 0;
}

export function neonctl(args: string[], capture: "json" | "text") {
  const result = spawnSync("neonctl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `neonctl ${args.join(" ")} failed${detail ? `:\n${detail}` : ` (exit ${result.status})`}`,
    );
  }
  const stdout = (result.stdout ?? "").trim();
  if (capture === "json") return JSON.parse(stdout) as unknown;
  return stdout;
}

export function listNeonProjects(): NeonProject[] {
  const payload = neonctl(["projects", "list", "--output", "json"], "json");
  const projects = Array.isArray(payload)
    ? payload
    : (payload as { projects?: NeonProject[] }).projects;
  if (!Array.isArray(projects)) fail("Could not parse neonctl projects list.");
  return projects.map((project) => ({ id: project.id, name: project.name }));
}

export function resolveNeonProject(opts: { projectId?: string; project?: string } = {}): NeonProject {
  if (opts.projectId) return { id: opts.projectId, name: opts.project ?? opts.projectId };
  if (!commandExists("neonctl")) {
    fail("neonctl is not installed. Install it (e.g. `brew install neonctl`) then run `neonctl auth`.");
  }
  try {
    neonctl(["me", "--output", "json"], "json");
  } catch {
    fail("neonctl is not authenticated. Run `neonctl auth` and retry.");
  }

  const projects = listNeonProjects();
  if (projects.length === 0) fail("No Neon projects found for this account.");

  const name = opts.project ?? DEFAULT_PROJECT_NAME;
  const matches = projects.filter((project) => project.name === name);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    fail(
      `Multiple Neon projects named "${name}". Pass --project-id with one of:\n` +
        matches.map((project) => `  ${project.id}`).join("\n"),
    );
  }
  if (opts.project) {
    fail(
      `No Neon project named "${name}". Available:\n` +
        projects.map((project) => `  ${project.name}  (${project.id})`).join("\n"),
    );
  }
  if (projects.length === 1) return projects[0]!;
  fail(
    `Multiple Neon projects found. Pass --project or --project-id:\n` +
      projects.map((project) => `  ${project.name}  (${project.id})`).join("\n"),
  );
}

export function neonConnectionString(opts: {
  projectId: string;
  branch?: string;
  pooled?: boolean;
}): string {
  const args = ["connection-string", "--project-id", opts.projectId];
  if (opts.branch) args.splice(1, 0, opts.branch);
  if (opts.pooled) args.push("--pooled");
  const url = neonctl(args, "text") as string;
  if (!/^postgres(ql)?:\/\//.test(url)) {
    fail("neonctl connection-string did not return a Postgres URL.");
  }
  if (!opts.pooled && url.includes("-pooler.")) {
    fail("Got a pooled Neon URL; drizzle-kit push needs the direct (unpooled) host.");
  }
  return url;
}

export function describePostgresUrl(url: string) {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
}
