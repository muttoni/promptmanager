import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/cli/doctor.js";

let tempRoot = "";

function configObject() {
  return {
    providers: {
      openai: { apiKeyEnv: "OPENAI_API_KEY" },
      anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      google: { apiKeyEnv: "GEMINI_API_KEY" },
    },
    suites: [
      {
        id: "customer-email-parser",
        promptId: "customer-email-parser",
        datasetPath: "evals/customer-email-parser/dataset.jsonl",
        schemaPath: "evals/customer-email-parser/schema.json",
        assertionsPath: "evals/customer-email-parser/assertions.json",
        toolsModule: "tools/customer-email-tools.mjs",
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

async function writeValidSuiteFiles(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "evals", "customer-email-parser"), { recursive: true });
  await fs.mkdir(path.join(root, "prompts", "customer-email-parser"), { recursive: true });
  await fs.mkdir(path.join(root, "tools"), { recursive: true });

  await fs.writeFile(
    path.join(root, "evals", "customer-email-parser", "dataset.jsonl"),
    `${JSON.stringify({ caseId: "case-1", input: {}, expected: {} })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "evals", "customer-email-parser", "schema.json"),
    JSON.stringify({ type: "object" }),
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "evals", "customer-email-parser", "assertions.json"),
    JSON.stringify({ requiredKeys: [] }),
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "prompts", "customer-email-parser", "v1.0.0.md"),
    "prompt\n",
    "utf8",
  );
  await fs.writeFile(path.join(root, "tools", "customer-email-tools.mjs"), "export const tools=[]; export const handlers={};\n", "utf8");
}

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("runDoctor", () => {
  it("passes on valid suite structure", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-doctor-"));
    await fs.writeFile(
      path.join(tempRoot, "promptmanager.config.json"),
      JSON.stringify(configObject(), null, 2),
      "utf8",
    );
    await writeValidSuiteFiles(tempRoot);

    const result = await runDoctor(tempRoot, {});
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
  });

  it("fails when required files are missing", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-doctor-"));
    await fs.writeFile(
      path.join(tempRoot, "promptmanager.config.json"),
      JSON.stringify(configObject(), null, 2),
      "utf8",
    );
    await fs.mkdir(path.join(tempRoot, "prompts", "customer-email-parser"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "prompts", "customer-email-parser", "v1.0.0.md"), "prompt\n", "utf8");

    const result = await runDoctor(tempRoot, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toBeGreaterThan(0);
  });
});
