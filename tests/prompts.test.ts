import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPromptRecord } from "../src/prompts.js";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("loadPromptRecord", () => {
  it("prefers latest v*.md even when meta.json points to older version", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-prompts-"));
    const promptDir = path.join(tempRoot, "prompts", "booking-parser");
    await fs.mkdir(promptDir, { recursive: true });

    await fs.writeFile(path.join(promptDir, "v1.0.0.md"), "old prompt\n", "utf8");
    await fs.writeFile(path.join(promptDir, "v1.1.0.md"), "new prompt\n", "utf8");
    await fs.writeFile(
      path.join(promptDir, "meta.json"),
      JSON.stringify({ currentVersion: "1.0.0", versions: ["1.0.0", "1.1.0"] }, null, 2),
      "utf8",
    );

    const record = await loadPromptRecord(tempRoot, "booking-parser");
    expect(record.version).toBe("1.1.0");
    expect(record.body).toContain("new prompt");
  });

  it("throws when no prompt versions exist", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptmgr-prompts-"));
    await fs.mkdir(path.join(tempRoot, "prompts", "empty-parser"), { recursive: true });

    await expect(loadPromptRecord(tempRoot, "empty-parser")).rejects.toThrowError(/No prompt version found/);
  });
});
