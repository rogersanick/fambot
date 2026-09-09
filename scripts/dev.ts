/**
 * Local dev orchestrator: API (8787) + worker + Vite (5173) in one command.
 * The bridge runs separately (`bun dev:bridge`) since it needs macOS
 * Full Disk Access to read the Messages database.
 */
import { spawn } from "node:child_process";

const procs: Array<{ name: string; args: string[]; cwd: string; color: string }> = [
  { name: "api", args: ["bun", "--watch", "src/index.ts"], cwd: "apps/api", color: "\x1b[36m" },
  { name: "worker", args: ["bun", "--watch", "src/index.ts"], cwd: "apps/worker", color: "\x1b[33m" },
  { name: "web", args: ["bunx", "vite"], cwd: "apps/desktop", color: "\x1b[35m" },
];

const children = procs.map(({ name, args, cwd, color }) => {
  const child = spawn(args[0]!, args.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream: NodeJS.ReadableStream) => {
    let buf = "";
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) console.log(prefix + line);
    });
  };
  pipe(child.stdout!);
  pipe(child.stderr!);
  child.on("exit", (code) => console.log(`${prefix}exited (${code})`));
  return child;
});

process.on("SIGINT", () => {
  for (const c of children) c.kill();
  process.exit(0);
});
