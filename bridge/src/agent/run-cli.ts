import { spawn } from "node:child_process";
import type { AgentRequest } from "./types.js";

export interface CliAgentOptions {
  /** Shell command, run via `sh -c`. Prompt arrives on stdin, reply on stdout. */
  command: string;
  timeoutMs: number;
  /** Extra env for the child (FAMBOT_MCP_URL, FAMBOT_MCP_TOKEN). */
  env: Record<string, string>;
}

/**
 * CLI adapter: any command that reads a prompt from stdin, does its own MCP
 * tool calling (config via FAMBOT_MCP_URL/FAMBOT_MCP_TOKEN), and prints the
 * reply to stdout. Works with `claude -p`, `cursor-agent -p`, custom scripts.
 */
export async function runCliAgent(request: AgentRequest, options: CliAgentOptions): Promise<string> {
  const prompt = `${request.system}\n\n---\n\n${request.user}`;

  return new Promise<string>((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", options.command], {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`agent command timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const reply = stdout.trim();
      if (code !== 0) {
        reject(new Error(`agent command exited ${code}: ${stderr.trim().slice(0, 400)}`));
      } else if (!reply) {
        reject(new Error("agent command produced no output"));
      } else {
        resolve(reply);
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
