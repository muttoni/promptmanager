import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  JsonValue,
  ToolExecutionContext,
  ToolRunnerConfig,
  ToolWorkerResponse,
} from "../types.js";
import { shellSplit, toErrorMessage } from "../utils.js";

const ALLOWED_BINARIES = new Set(["node", "bun", "deno"]);

export class ToolRunnerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function resolveWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../runtime/tool-worker.mjs");
}

function buildSanitizedEnv(allowlist: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  // Needed for resolving the runner binary in local developer environments.
  env.PATH = process.env.PATH;

  for (const key of allowlist) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  return env;
}

export class ToolRunner {
  private readonly commandParts: string[];
  private readonly workerPath: string;

  constructor(
    private readonly config: ToolRunnerConfig,
    private readonly cwd: string,
  ) {
    this.commandParts = shellSplit(config.command);
    if (this.commandParts.length === 0) {
      throw new ToolRunnerError("INVALID_COMMAND", "toolRunner.command cannot be empty.");
    }
    const binary = path.basename(this.commandParts[0]);
    if (!ALLOWED_BINARIES.has(binary)) {
      throw new ToolRunnerError(
        "COMMAND_NOT_ALLOWLISTED",
        `Tool runner command '${binary}' is not allowlisted. Allowed: ${Array.from(ALLOWED_BINARIES).join(", ")}`,
      );
    }
    this.workerPath = resolveWorkerPath();
  }

  async execute(
    toolName: string,
    toolsModulePath: string,
    args: JsonValue,
    context: ToolExecutionContext,
  ): Promise<JsonValue> {
    const [binary, ...baseArgs] = this.commandParts;
    const spawnArgs = [...baseArgs, this.workerPath, "--tools-module", toolsModulePath, "--tool", toolName];

    return new Promise<JsonValue>((resolve, reject) => {
      const child = spawn(binary, spawnArgs, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...buildSanitizedEnv(this.config.envAllowlist),
          PROMPTMGR_BLOCK_NETWORK: "true",
        },
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new ToolRunnerError("TOOL_TIMEOUT", `Tool '${toolName}' timed out after ${this.config.timeoutMs}ms.`));
      }, this.config.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new ToolRunnerError("TOOL_PROCESS_ERROR", error.message));
      });

      child.on("close", () => {
        clearTimeout(timer);
        const text = stdout.trim();
        if (!text) {
          reject(
            new ToolRunnerError(
              "TOOL_EMPTY_RESPONSE",
              `Tool '${toolName}' returned no output. stderr=${stderr.trim()}`,
            ),
          );
          return;
        }

        let parsed: ToolWorkerResponse;
        try {
          parsed = JSON.parse(text) as ToolWorkerResponse;
        } catch {
          reject(
            new ToolRunnerError(
              "TOOL_INVALID_RESPONSE",
              `Tool '${toolName}' returned invalid JSON: ${text.slice(0, 200)}`,
            ),
          );
          return;
        }

        if (!parsed.ok) {
          reject(
            new ToolRunnerError(
              parsed.error?.code ?? "TOOL_EXECUTION_ERROR",
              parsed.error?.message ?? `Tool '${toolName}' failed without an error message.`,
            ),
          );
          return;
        }

        resolve(parsed.result ?? null);
      });

      try {
        child.stdin.write(
          JSON.stringify({
            args,
            context,
          }),
        );
        child.stdin.end();
      } catch (error) {
        clearTimeout(timer);
        reject(new ToolRunnerError("TOOL_INPUT_ERROR", toErrorMessage(error)));
      }
    });
  }
}
