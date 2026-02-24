import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolRunner, ToolRunnerError } from "../src/tools/toolRunner.js";

let tempDir = "";
let toolsModulePath = "";
let networkToolsModulePath = "";

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-tools-"));

  toolsModulePath = path.join(tempDir, "tools.mjs");
  await fs.writeFile(
    toolsModulePath,
    `
      export const handlers = {
        async sum_numbers(args) {
          return { total: Number(args.a) + Number(args.b) };
        }
      };
      export const tools = [{
        name: "sum_numbers",
        description: "adds two numbers",
        inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] }
      }];
    `,
    "utf8",
  );

  networkToolsModulePath = path.join(tempDir, "network-tools.mjs");
  await fs.writeFile(
    networkToolsModulePath,
    `
      export const handlers = {
        async net_call() {
          await fetch("https://example.com");
          return { ok: true };
        }
      };
      export const tools = [{ name: "net_call" }];
    `,
    "utf8",
  );
});

afterAll(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe("ToolRunner", () => {
  it("executes tool handlers in subprocess", async () => {
    const runner = new ToolRunner(
      {
        mode: "subprocess",
        command: "node",
        envAllowlist: [],
        timeoutMs: 2000,
        maxToolCallsPerCase: 5,
      },
      process.cwd(),
    );

    const result = await runner.execute(
      "sum_numbers",
      toolsModulePath,
      { a: 2, b: 3 },
      {
        suiteId: "suite",
        hashedCaseId: "abc",
        rawCaseId: "sample",
        provider: "openai",
        model: "gpt-test",
      },
    );

    expect(result).toEqual({ total: 5 });
  });

  it("blocks non-allowlisted runner binaries", async () => {
    expect(
      () =>
        new ToolRunner(
          {
            mode: "subprocess",
            command: "python",
            envAllowlist: [],
            timeoutMs: 1000,
            maxToolCallsPerCase: 1,
          },
          process.cwd(),
        ),
    ).toThrowError(/COMMAND_NOT_ALLOWLISTED|allowlisted/);
  });

  it("blocks network calls inside worker", async () => {
    const runner = new ToolRunner(
      {
        mode: "subprocess",
        command: "node",
        envAllowlist: [],
        timeoutMs: 2000,
        maxToolCallsPerCase: 5,
      },
      process.cwd(),
    );

    let caught: unknown;
    try {
      await runner.execute(
        "net_call",
        networkToolsModulePath,
        {},
        {
          suiteId: "suite",
          hashedCaseId: "abc",
          rawCaseId: "sample",
          provider: "openai",
          model: "gpt-test",
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ToolRunnerError);
    expect((caught as ToolRunnerError).code).toBe("TOOL_EXECUTION_ERROR");
  });
});
