import fs from "node:fs/promises";
import path from "node:path";
import { getSuite, loadConfig } from "../config.js";
import { JsonValue } from "../types.js";

export interface AddCaseOptions {
  caseId?: string;
  input?: string;
  inputFile?: string;
  expected?: string;
  expectedFile?: string;
  tags?: string;
  config?: string;
  dataset?: string;
}

function parseJsonValue(raw: string, label: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch (error) {
    throw new Error(
      `Failed to parse ${label} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function loadJsonInput(
  label: string,
  inlineValue?: string,
  filePathValue?: string,
): Promise<JsonValue> {
  if (inlineValue && filePathValue) {
    throw new Error(`Provide either --${label} or --${label}-file, not both.`);
  }
  if (!inlineValue && !filePathValue) {
    throw new Error(`Missing required --${label} (or --${label}-file).`);
  }

  if (inlineValue) {
    return parseJsonValue(inlineValue, `--${label}`);
  }

  const resolved = path.resolve(filePathValue as string);
  const raw = await fs.readFile(resolved, "utf8");
  return parseJsonValue(raw, `--${label}-file (${resolved})`);
}

function parseTags(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function defaultCaseId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `case-${stamp}`;
}

async function assertCaseIdUnique(datasetPath: string, caseId: string): Promise<void> {
  if (!(await fileExists(datasetPath))) {
    return;
  }

  const raw = await fs.readFile(datasetPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { caseId?: unknown };
      if (parsed.caseId === caseId) {
        throw new Error(`Case ID '${caseId}' already exists in ${datasetPath}.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Case ID")) {
        throw error;
      }
      // Ignore malformed historical lines here; they will be flagged by run-time dataset parsing.
    }
  }
}

export async function runAddCase(cwd: string, suiteId: string, options: AddCaseOptions): Promise<void> {
  const resolvedCwd = path.resolve(cwd);
  const { path: configPath, config } = await loadConfig(resolvedCwd, options.config);
  const suite = getSuite(config, suiteId);
  const configDir = path.dirname(configPath);

  const datasetPath = options.dataset
    ? path.resolve(resolvedCwd, options.dataset)
    : path.resolve(configDir, suite.datasetPath);

  const caseId = options.caseId ?? defaultCaseId();
  const input = await loadJsonInput("input", options.input, options.inputFile);
  const expected = await loadJsonInput("expected", options.expected, options.expectedFile);
  const tags = parseTags(options.tags);

  await assertCaseIdUnique(datasetPath, caseId);

  const payload = {
    caseId,
    input,
    expected,
    tags,
  };

  await fs.mkdir(path.dirname(datasetPath), { recursive: true });

  let prefix = "";
  if (await fileExists(datasetPath)) {
    const current = await fs.readFile(datasetPath, "utf8");
    prefix = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  }

  await fs.appendFile(datasetPath, `${prefix}${JSON.stringify(payload)}\n`, "utf8");

  process.stdout.write(`Added case '${caseId}' to ${datasetPath}\n`);
}
