import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAddSuite } from "../src/cli/addSuite.js";
import { loadConfig } from "../src/config.js";

async function writeBaseEvalFiles(root: string, suiteId: string): Promise<void> {
  const evalDir = path.join(root, "evals", suiteId);
  await fs.mkdir(evalDir, { recursive: true });

  await fs.writeFile(
    path.join(evalDir, "schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          field: { type: "string" },
        },
        required: ["field"],
        additionalProperties: false,
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(evalDir, "assertions.json"),
    JSON.stringify(
      {
        requiredKeys: ["field"],
        allowAdditionalKeys: false,
        fieldMatchers: {
          field: [{ op: "regex", value: "^.+$" }],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(evalDir, "dataset.jsonl"),
    `${JSON.stringify({ caseId: "sample-001", input: { text: "hello" }, expected: { field: "hello" } })}\n`,
    "utf8",
  );
}

function baseConfigObject() {
  return {
    providers: {
      openai: { apiKeyEnv: "OPENAI_API_KEY" },
      anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      google: { apiKeyEnv: "GEMINI_API_KEY" },
    },
    suites: [
      {
        id: "template-suite",
        promptId: "template-suite",
        datasetPath: "evals/template-suite/dataset.jsonl",
        schemaPath: "evals/template-suite/schema.json",
        assertionsPath: "evals/template-suite/assertions.json",
        toolsModule: "tools/shared-tools.mjs",
        modelByProvider: {
          openai: "gpt-5-mini",
          anthropic: "claude-3-5-sonnet-latest",
          google: "gemini-2.0-flash",
        },
      },
    ],
    toolRunner: {
      mode: "subprocess",
      command: "node",
      envAllowlist: ["TZ"],
      timeoutMs: 5000,
      maxToolCallsPerCase: 8,
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
  };
}

async function writeSharedTools(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "tools"), { recursive: true });
  await fs.writeFile(
    path.join(root, "tools", "shared-tools.mjs"),
    "export const tools = []; export const handlers = {};\n",
    "utf8",
  );
}

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("runAddSuite", () => {
  it("adds a suite for JSON config and scaffolds files", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-add-suite-json-"));

    await writeSharedTools(tempRoot);
    await writeBaseEvalFiles(tempRoot, "template-suite");

    const configPath = path.join(tempRoot, "promptmanager.config.json");
    await fs.writeFile(configPath, `${JSON.stringify(baseConfigObject(), null, 2)}\n`, "utf8");

    await runAddSuite(tempRoot, "refund-email", { config: configPath });

    const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      suites: Array<{ id: string; datasetPath: string }>;
    };

    expect(parsed.suites.some((suite) => suite.id === "refund-email")).toBe(true);
    expect(await fs.readFile(path.join(tempRoot, "evals/refund-email/schema.json"), "utf8")).toContain(
      "additionalProperties",
    );
    expect(await fs.readFile(path.join(tempRoot, "prompts/refund-email/v1.0.0.md"), "utf8")).toContain(
      "refund-email",
    );
  });

  it("adds a suite for TypeScript config and keeps config loadable", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-add-suite-ts-"));

    await writeSharedTools(tempRoot);
    await writeBaseEvalFiles(tempRoot, "template-suite");

    const configTs = `const config = ${JSON.stringify(baseConfigObject(), null, 2)};\n\nexport default config;\n`;
    await fs.writeFile(path.join(tempRoot, "promptmanager.config.ts"), configTs, "utf8");

    await runAddSuite(tempRoot, "booking-change", { fromSuite: "template-suite" });

    const { config } = await loadConfig(tempRoot);
    const suite = config.suites.find((item) => item.id === "booking-change");

    expect(suite).toBeDefined();
    expect(suite?.datasetPath).toBe("evals/booking-change/dataset.jsonl");
    expect(await fs.readFile(path.join(tempRoot, "evals/booking-change/assertions.json"), "utf8")).toContain(
      "requiredKeys",
    );
  });
});
