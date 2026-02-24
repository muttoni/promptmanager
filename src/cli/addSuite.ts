import fs from "node:fs/promises";
import path from "node:path";
import { findConfigPath, loadConfig } from "../config.js";
import { SuiteConfig } from "../types.js";

export interface AddSuiteOptions {
  promptId?: string;
  fromSuite?: string;
  config?: string;
  force?: boolean;
}

type WriteOutcome = "created" | "skipped";

const SUITE_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

function q(value: string): string {
  return JSON.stringify(value);
}

function toPosixPath(...parts: string[]): string {
  return parts.join("/").replace(/\\+/g, "/");
}

function assertSuiteId(value: string): void {
  if (!SUITE_ID_PATTERN.test(value)) {
    throw new Error(
      `Invalid suite id '${value}'. Use lowercase letters, digits, '-' or '_', and start with a letter or digit.`,
    );
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFileSafe(filePath: string, content: string, force: boolean): Promise<WriteOutcome> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (!force && (await pathExists(filePath))) {
    return "skipped";
  }
  await fs.writeFile(filePath, content, "utf8");
  return "created";
}

async function copyOrWriteFileSafe(
  targetPath: string,
  sourcePath: string,
  fallbackContent: string,
  force: boolean,
): Promise<WriteOutcome> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (!force && (await pathExists(targetPath))) {
    return "skipped";
  }

  if (await pathExists(sourcePath)) {
    const source = await fs.readFile(sourcePath, "utf8");
    await fs.writeFile(targetPath, source, "utf8");
    return "created";
  }

  await fs.writeFile(targetPath, fallbackContent, "utf8");
  return "created";
}

function findTemplateSuite(suites: SuiteConfig[], fromSuite?: string): SuiteConfig {
  if (suites.length === 0) {
    throw new Error("Config has no suites. Run 'promptmgr init' first.");
  }
  if (!fromSuite) {
    return suites[0];
  }
  const match = suites.find((suite) => suite.id === fromSuite);
  if (!match) {
    const available = suites.map((suite) => suite.id).join(", ");
    throw new Error(`Unknown from-suite '${fromSuite}'. Available suites: ${available}`);
  }
  return match;
}

function buildSuite(template: SuiteConfig, suiteId: string, promptId: string): SuiteConfig {
  return {
    id: suiteId,
    promptId,
    datasetPath: toPosixPath("evals", suiteId, "dataset.jsonl"),
    schemaPath: toPosixPath("evals", suiteId, "schema.json"),
    assertionsPath: toPosixPath("evals", suiteId, "assertions.json"),
    toolsModule: template.toolsModule,
    modelByProvider: {
      openai: template.modelByProvider.openai,
      anthropic: template.modelByProvider.anthropic,
      google: template.modelByProvider.google,
    },
  };
}

function getLineIndent(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const match = source.slice(lineStart).match(/^[ \t]*/);
  return match?.[0] ?? "";
}

function findMatchingBracket(source: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaping = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "[") {
      depth += 1;
      continue;
    }

    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  throw new Error("Could not locate end of suites array in config.");
}

function serializeTsSuite(suite: SuiteConfig, itemIndent: string): string {
  const fieldIndent = `${itemIndent}  `;
  const modelIndent = `${fieldIndent}  `;

  return [
    `${itemIndent}{`,
    `${fieldIndent}id: ${q(suite.id)},`,
    `${fieldIndent}promptId: ${q(suite.promptId)},`,
    `${fieldIndent}datasetPath: ${q(suite.datasetPath)},`,
    `${fieldIndent}schemaPath: ${q(suite.schemaPath)},`,
    `${fieldIndent}assertionsPath: ${q(suite.assertionsPath)},`,
    `${fieldIndent}toolsModule: ${q(suite.toolsModule)},`,
    `${fieldIndent}modelByProvider: {`,
    `${modelIndent}openai: ${q(suite.modelByProvider.openai)},`,
    `${modelIndent}anthropic: ${q(suite.modelByProvider.anthropic)},`,
    `${modelIndent}google: ${q(suite.modelByProvider.google)}`,
    `${fieldIndent}}`,
    `${itemIndent}}`,
  ].join("\n");
}

function insertSuiteIntoTsConfig(source: string, suite: SuiteConfig): string {
  const suitesMatch = /["']?suites["']?\s*:\s*\[/m.exec(source);
  if (!suitesMatch) {
    throw new Error("Could not find 'suites: [' in TypeScript config.");
  }

  const suitesIndex = suitesMatch.index;
  const arrayOpen = source.indexOf("[", suitesIndex);
  if (arrayOpen === -1) {
    throw new Error("Could not parse suites array in TypeScript config.");
  }
  const arrayClose = findMatchingBracket(source, arrayOpen);

  const suitesIndent = getLineIndent(source, suitesIndex);
  const itemIndent = `${suitesIndent}  `;
  const suiteLiteral = serializeTsSuite(suite, itemIndent);
  const arrayInner = source.slice(arrayOpen + 1, arrayClose);

  if (arrayInner.trim().length === 0) {
    const insertion = `\n${suiteLiteral}\n${suitesIndent}`;
    return `${source.slice(0, arrayOpen + 1)}${insertion}${source.slice(arrayClose)}`;
  }

  let lastNonWhitespace = arrayClose - 1;
  while (lastNonWhitespace > arrayOpen && /\s/.test(source[lastNonWhitespace])) {
    lastNonWhitespace -= 1;
  }

  const separator = source[lastNonWhitespace] === "," ? "" : ",";
  return [
    source.slice(0, lastNonWhitespace + 1),
    `${separator}\n${suiteLiteral}\n${suitesIndent}`,
    source.slice(lastNonWhitespace + 1),
  ].join("");
}

async function appendSuiteToConfig(configPath: string, suite: SuiteConfig): Promise<void> {
  const ext = path.extname(configPath).toLowerCase();
  if (ext === ".json") {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as { suites?: SuiteConfig[] };
    if (!Array.isArray(parsed.suites)) {
      throw new Error("Config JSON is missing a suites array.");
    }
    parsed.suites.push(suite);
    await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    return;
  }

  if (ext === ".ts") {
    const source = await fs.readFile(configPath, "utf8");
    const updated = insertSuiteIntoTsConfig(source, suite);
    await fs.writeFile(configPath, updated, "utf8");
    return;
  }

  throw new Error(`Unsupported config extension '${ext}'.`);
}

function defaultPromptContent(suiteId: string): string {
  return `You extract structured data for suite '${suiteId}'.

Rules:
1. Return valid JSON only.
2. Use tool-calling when a tool is required by this suite.
3. Return null for missing fields.
`;
}

const DEFAULT_SCHEMA = `${JSON.stringify(
  {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: true,
  },
  null,
  2,
)}\n`;

const DEFAULT_ASSERTIONS = `${JSON.stringify(
  {
    requiredKeys: [],
    allowAdditionalKeys: true,
    variableFields: [],
    fieldMatchers: {},
  },
  null,
  2,
)}\n`;

const DEFAULT_DATASET = `# Add one JSON object per line\n# {"caseId":"example-001","input":{},"expected":{},"tags":["smoke"]}\n`;

export async function runAddSuite(cwd: string, suiteId: string, options: AddSuiteOptions): Promise<void> {
  assertSuiteId(suiteId);
  const resolvedCwd = path.resolve(cwd);

  const { config, path: loadedConfigPath } = await loadConfig(resolvedCwd, options.config);
  const configPath = await findConfigPath(resolvedCwd, options.config);
  const configDir = path.dirname(loadedConfigPath);

  if (config.suites.some((suite) => suite.id === suiteId)) {
    throw new Error(`Suite '${suiteId}' already exists.`);
  }

  const templateSuite = findTemplateSuite(config.suites, options.fromSuite);
  const promptId = options.promptId ?? suiteId;
  const force = options.force ?? false;

  const newSuite = buildSuite(templateSuite, suiteId, promptId);

  const sourceSchemaPath = path.resolve(configDir, templateSuite.schemaPath);
  const sourceAssertionsPath = path.resolve(configDir, templateSuite.assertionsPath);
  const sourceDatasetPath = path.resolve(configDir, templateSuite.datasetPath);

  const targetSchemaPath = path.resolve(configDir, newSuite.schemaPath);
  const targetAssertionsPath = path.resolve(configDir, newSuite.assertionsPath);
  const targetDatasetPath = path.resolve(configDir, newSuite.datasetPath);

  const promptDir = path.resolve(resolvedCwd, "prompts", promptId);
  const promptMetaPath = path.join(promptDir, "meta.json");
  const promptVersionPath = path.join(promptDir, "v1.0.0.md");

  let created = 0;
  let skipped = 0;

  const outcomes: WriteOutcome[] = [
    await copyOrWriteFileSafe(targetSchemaPath, sourceSchemaPath, DEFAULT_SCHEMA, force),
    await copyOrWriteFileSafe(targetAssertionsPath, sourceAssertionsPath, DEFAULT_ASSERTIONS, force),
    await copyOrWriteFileSafe(targetDatasetPath, sourceDatasetPath, DEFAULT_DATASET, force),
    await writeFileSafe(
      promptMetaPath,
      `${JSON.stringify({ currentVersion: "1.0.0", versions: ["1.0.0"] }, null, 2)}\n`,
      force,
    ),
    await writeFileSafe(promptVersionPath, defaultPromptContent(suiteId), force),
  ];

  for (const outcome of outcomes) {
    if (outcome === "created") {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  await appendSuiteToConfig(configPath, newSuite);

  process.stdout.write(`Added suite '${suiteId}' to config: ${configPath}\n`);
  process.stdout.write(`Scaffold files: created=${created} skipped=${skipped}\n`);
  process.stdout.write(`Next: add real cases to ${newSuite.datasetPath} and refine prompts/${promptId}/v1.0.0.md\n`);
}
