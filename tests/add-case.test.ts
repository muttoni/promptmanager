import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAddCase } from "../src/cli/addCase.js";

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
        id: "refund-email-parser",
        promptId: "refund-email-parser",
        datasetPath: "evals/refund-email-parser/dataset.jsonl",
        schemaPath: "evals/refund-email-parser/schema.json",
        assertionsPath: "evals/refund-email-parser/assertions.json",
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

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("runAddCase", () => {
  it("appends a case to dataset", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-add-case-"));

    await fs.writeFile(
      path.join(tempRoot, "promptmanager.config.json"),
      JSON.stringify(configObject(), null, 2),
      "utf8",
    );

    const datasetDir = path.join(tempRoot, "evals", "refund-email-parser");
    await fs.mkdir(datasetDir, { recursive: true });
    await fs.writeFile(path.join(datasetDir, "dataset.jsonl"), "", "utf8");

    await runAddCase(tempRoot, "refund-email-parser", {
      caseId: "refund-001",
      input: JSON.stringify({ subject: "Refund requested", body: "Please refund" }),
      expected: JSON.stringify({ status: "pending" }),
      tags: "smoke,refund",
    });

    const rows = (await fs.readFile(path.join(datasetDir, "dataset.jsonl"), "utf8")).trim().split(/\r?\n/);
    expect(rows).toHaveLength(1);
    const parsed = JSON.parse(rows[0]) as { caseId: string; tags: string[] };
    expect(parsed.caseId).toBe("refund-001");
    expect(parsed.tags).toEqual(["smoke", "refund"]);
  });

  it("rejects duplicate case ids", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-add-case-"));

    await fs.writeFile(
      path.join(tempRoot, "promptmanager.config.json"),
      JSON.stringify(configObject(), null, 2),
      "utf8",
    );

    const datasetDir = path.join(tempRoot, "evals", "refund-email-parser");
    await fs.mkdir(datasetDir, { recursive: true });
    await fs.writeFile(
      path.join(datasetDir, "dataset.jsonl"),
      `${JSON.stringify({ caseId: "refund-001", input: {}, expected: {} })}\n`,
      "utf8",
    );

    await expect(
      runAddCase(tempRoot, "refund-email-parser", {
        caseId: "refund-001",
        input: JSON.stringify({ subject: "dup" }),
        expected: JSON.stringify({ status: "pending" }),
      }),
    ).rejects.toThrowError(/already exists/);
  });
});
