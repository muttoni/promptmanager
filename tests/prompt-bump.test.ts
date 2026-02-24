import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPromptBump } from "../src/cli/promptBump.js";

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
        datasetPath: "evals/customer-email/dataset.jsonl",
        schemaPath: "evals/customer-email/schema.json",
        assertionsPath: "evals/customer-email/assertions.json",
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

async function writeMinimalSuiteFiles(root: string): Promise<void> {
  const evalDir = path.join(root, "evals/customer-email");
  await fs.mkdir(evalDir, { recursive: true });
  await fs.writeFile(path.join(evalDir, "dataset.jsonl"), `${JSON.stringify({ caseId: "x", input: {}, expected: {} })}\n`);
  await fs.writeFile(path.join(evalDir, "schema.json"), JSON.stringify({ type: "object" }));
  await fs.writeFile(path.join(evalDir, "assertions.json"), JSON.stringify({ requiredKeys: [] }));
  await fs.mkdir(path.join(root, "tools"), { recursive: true });
  await fs.writeFile(path.join(root, "tools", "customer-email-tools.mjs"), "export const tools=[]; export const handlers={};\n");
}

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("runPromptBump", () => {
  it("creates next patch version from latest prompt file", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-bump-"));
    await fs.writeFile(
      path.join(tempRoot, "promptmanager.config.json"),
      JSON.stringify(configObject(), null, 2),
      "utf8",
    );
    await writeMinimalSuiteFiles(tempRoot);

    const promptDir = path.join(tempRoot, "prompts", "customer-email-parser");
    await fs.mkdir(promptDir, { recursive: true });
    await fs.writeFile(path.join(promptDir, "v1.0.0.md"), "prompt body\n", "utf8");

    await runPromptBump(tempRoot, "customer-email-parser", { part: "patch" });

    const created = await fs.readFile(path.join(promptDir, "v1.0.1.md"), "utf8");
    expect(created).toContain("prompt body");
  });

  it("creates v1.0.0 when no prompt versions exist", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-bump-"));
    await fs.writeFile(
      path.join(tempRoot, "promptmanager.config.json"),
      JSON.stringify(configObject(), null, 2),
      "utf8",
    );
    await writeMinimalSuiteFiles(tempRoot);

    await runPromptBump(tempRoot, "customer-email-parser", { part: "patch" });

    const created = await fs.readFile(
      path.join(tempRoot, "prompts", "customer-email-parser", "v1.0.0.md"),
      "utf8",
    );
    expect(created).toContain("customer-email-parser");
  });
});
