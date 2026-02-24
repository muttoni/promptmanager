import fs from "node:fs/promises";
import { EvalCase, JsonValue } from "./types.js";

function parseLine(line: string, lineNumber: number): EvalCase {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new Error(`Invalid JSONL at line ${lineNumber}: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`JSONL line ${lineNumber} must be an object.`);
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.caseId !== "string" || obj.caseId.trim().length === 0) {
    throw new Error(`JSONL line ${lineNumber} is missing required string 'caseId'.`);
  }
  if (!("input" in obj)) {
    throw new Error(`JSONL line ${lineNumber} is missing required 'input'.`);
  }
  if (!("expected" in obj)) {
    throw new Error(`JSONL line ${lineNumber} is missing required 'expected'.`);
  }

  return {
    caseId: obj.caseId,
    input: obj.input as JsonValue,
    expected: obj.expected as JsonValue,
    tags: Array.isArray(obj.tags) ? obj.tags.map((tag) => String(tag)) : [],
  };
}

export async function loadDataset(datasetPath: string): Promise<EvalCase[]> {
  const raw = await fs.readFile(datasetPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines.map((line, index) => parseLine(line, index + 1));
}
