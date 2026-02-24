import { describe, expect, it } from "vitest";
import { diffRuns } from "../src/diffRuns.js";
import { RunReport } from "../src/types.js";

function makeReport(statuses: Array<[string, "pass" | "fail" | "error"]>): RunReport {
  return {
    version: "1",
    suiteId: "suite-a",
    provider: "openai",
    model: "gpt-test",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    summary: {
      total: statuses.length,
      pass: statuses.filter(([, status]) => status === "pass").length,
      fail: statuses.filter(([, status]) => status === "fail").length,
      error: statuses.filter(([, status]) => status === "error").length,
      durationMs: 1,
    },
    warnings: [],
    prompt: {
      promptId: "confirmation-parser",
      version: "1.0.0",
    },
    cases: statuses.map(([id, status]) => ({
      hashedCaseId: id,
      rawCaseId: "[HASHED]",
      status,
      schemaValid: status === "pass",
      assertionsPassed: status === "pass",
      assertionResult: {
        passed: status === "pass",
        checks: [],
        missingKeys: [],
        unexpectedKeys: [],
      },
      errors: [],
      output: {},
      redactedOutput: {},
      expected: {},
      latencyMs: 1,
      provider: "openai",
      model: "gpt-test",
      usage: undefined,
      toolTrace: [],
      tags: [],
    })),
  };
}

describe("diffRuns", () => {
  it("identifies regressions and improvements", () => {
    const baseline = makeReport([
      ["a", "pass"],
      ["b", "fail"],
      ["c", "error"],
    ]);
    const candidate = makeReport([
      ["a", "fail"],
      ["b", "pass"],
      ["c", "error"],
    ]);

    const diff = diffRuns(baseline, candidate);
    expect(diff.regressions).toHaveLength(1);
    expect(diff.regressions[0].hashedCaseId).toBe("a");
    expect(diff.improvements).toHaveLength(1);
    expect(diff.improvements[0].hashedCaseId).toBe("b");
    expect(diff.unchanged).toBe(1);
  });
});
