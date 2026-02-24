import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSuite } from "../src/runSuite.js";
import { clearProvidersForTests } from "../src/providers/registry.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let repoDir = "";

beforeEach(async () => {
  repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-run-"));
  clearProvidersForTests();

  await fs.mkdir(path.join(repoDir, "prompts/confirmation-parser"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "evals/confirmation"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "tools"), { recursive: true });

  await fs.writeFile(
    path.join(repoDir, "promptmanager.config.json"),
    JSON.stringify(
      {
        providers: {
          openai: { apiKeyEnv: "OPENAI_API_KEY" },
          anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
          google: { apiKeyEnv: "GEMINI_API_KEY" },
        },
        suites: [
          {
            id: "confirmation-emails",
            promptId: "confirmation-parser",
            datasetPath: "evals/confirmation/dataset.jsonl",
            schemaPath: "evals/confirmation/schema.json",
            assertionsPath: "evals/confirmation/assertions.json",
            toolsModule: "tools/confirmation-tools.mjs",
            modelByProvider: {
              openai: "gpt-test",
              anthropic: "claude-test",
              google: "gemini-test",
            },
          },
        ],
        toolRunner: {
          mode: "subprocess",
          command: "node",
          envAllowlist: [],
          timeoutMs: 3000,
          maxToolCallsPerCase: 6,
        },
        privacy: {
          allowRawProductionFixtures: true,
          redactInReports: true,
          encryptionAtRest: false,
        },
        reporting: {
          includeToolTrace: true,
          outDir: "promptmanager-reports",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(repoDir, "prompts/confirmation-parser/meta.json"),
    JSON.stringify({ currentVersion: "1.0.0", versions: ["1.0.0"] }, null, 2),
    "utf8",
  );

  await fs.writeFile(
    path.join(repoDir, "prompts/confirmation-parser/v1.0.0.md"),
    "Extract booking_status as JSON.",
    "utf8",
  );

  await fs.writeFile(
    path.join(repoDir, "evals/confirmation/dataset.jsonl"),
    `${JSON.stringify({
      caseId: "case-1",
      input: { subject: "Booking", body: "Confirmed" },
      expected: { booking_status: "confirmed" },
      tags: ["smoke"],
    })}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(repoDir, "evals/confirmation/schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          booking_status: { type: "string" },
        },
        required: ["booking_status"],
        additionalProperties: false,
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(repoDir, "evals/confirmation/assertions.json"),
    JSON.stringify(
      {
        requiredKeys: ["booking_status"],
        allowAdditionalKeys: false,
        variableFields: [],
        fieldMatchers: {
          booking_status: [{ op: "oneOf", value: ["confirmed", "pending", "cancelled"] }],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(repoDir, "tools/confirmation-tools.mjs"),
    `
      export const tools = [{
        name: "normalize_status",
        description: "Normalize booking status",
        inputSchema: {
          type: "object",
          properties: { raw_status: { type: "string" } },
          required: ["raw_status"],
          additionalProperties: false
        }
      }];

      export const handlers = {
        async normalize_status(args) {
          const value = String(args.raw_status || "").toLowerCase();
          return { status: value.includes("confirm") ? "confirmed" : "pending" };
        }
      };
    `,
    "utf8",
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  clearProvidersForTests();
  delete process.env.OPENAI_API_KEY;
  if (repoDir) {
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

describe("runSuite", () => {
  it("runs suite with tool-calling and produces passing report", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "resp-1",
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "normalize_status",
              arguments: JSON.stringify({ raw_status: "Confirmed" }),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "resp-2",
          output_text: '{"booking_status":"confirmed"}',
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"booking_status":"confirmed"}' }],
            },
          ],
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const report = await runSuite({
      cwd: repoDir,
      suiteId: "confirmation-emails",
      provider: "openai",
      concurrency: 1,
    });

    expect(report.summary.total).toBe(1);
    expect(report.summary.pass).toBe(1);
    expect(report.cases[0].status).toBe("pass");
    expect(report.cases[0].toolTrace).toHaveLength(1);
    expect(report.cases[0].hashedCaseId).toMatch(/^[a-f0-9]{16}$/);
  });
});
