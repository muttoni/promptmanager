import fs from "node:fs/promises";
import path from "node:path";
import { getSuite, loadConfig } from "../config.js";
import { loadDataset } from "../dataset.js";
import { listPromptVersions } from "../prompts.js";
import { PromptMeta } from "../types.js";
import { readJsonFile } from "../utils.js";

export interface DoctorOptions {
  config?: string;
  suite?: string;
}

interface Issue {
  level: "ok" | "warn" | "error";
  message: string;
}

interface DoctorResult {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: Issue[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pushIssue(issues: Issue[], level: Issue["level"], message: string): void {
  issues.push({ level, message });
}

function printIssues(result: DoctorResult): void {
  for (const issue of result.issues) {
    const prefix = issue.level === "ok" ? "OK" : issue.level === "warn" ? "WARN" : "ERROR";
    process.stdout.write(`[${prefix}] ${issue.message}\n`);
  }
  process.stdout.write(
    `\nDoctor summary: errors=${result.errors} warnings=${result.warnings} status=${result.ok ? "PASS" : "FAIL"}\n`,
  );
}

export async function runDoctor(cwd: string, options: DoctorOptions): Promise<DoctorResult> {
  const issues: Issue[] = [];

  let loaded;
  try {
    loaded = await loadConfig(cwd, options.config);
    pushIssue(issues, "ok", `Loaded config: ${loaded.path}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: DoctorResult = {
      ok: false,
      errors: 1,
      warnings: 0,
      issues: [{ level: "error", message: `Failed to load config: ${message}` }],
    };
    printIssues(result);
    return result;
  }

  const { config, path: configPath } = loaded;
  const configDir = path.dirname(configPath);

  const suiteIds = options.suite ? [getSuite(config, options.suite).id] : config.suites.map((suite) => suite.id);

  for (const suiteId of suiteIds) {
    const suite = getSuite(config, suiteId);
    pushIssue(issues, "ok", `Checking suite: ${suiteId}`);

    const promptDir = path.resolve(cwd, "prompts", suite.promptId);
    if (!(await exists(promptDir))) {
      pushIssue(issues, "error", `Missing prompt directory: ${promptDir}`);
    } else {
      const versions = await listPromptVersions(promptDir);
      if (versions.length === 0) {
        pushIssue(issues, "error", `No prompt versions found in ${promptDir}. Add files like v1.0.0.md`);
      } else {
        pushIssue(issues, "ok", `Prompt versions found: latest=v${versions[versions.length - 1]}.md`);
      }

      const metaPath = path.join(promptDir, "meta.json");
      if (await exists(metaPath)) {
        try {
          const meta = await readJsonFile<PromptMeta>(metaPath);
          if (meta.currentVersion && !(await exists(path.join(promptDir, `v${meta.currentVersion}.md`)))) {
            pushIssue(
              issues,
              "warn",
              `meta.json currentVersion points to missing file v${meta.currentVersion}.md (safe to ignore; latest v*.md is auto-picked).`,
            );
          } else {
            pushIssue(issues, "ok", "meta.json present (optional)");
          }
        } catch (error) {
          pushIssue(
            issues,
            "warn",
            `meta.json is unreadable (${error instanceof Error ? error.message : String(error)}); latest v*.md still works.`,
          );
        }
      } else {
        pushIssue(issues, "ok", "meta.json not found (optional)");
      }
    }

    const schemaPath = path.resolve(configDir, suite.schemaPath);
    if (!(await exists(schemaPath))) {
      pushIssue(issues, "error", `Missing schema file: ${schemaPath}`);
    } else {
      try {
        JSON.parse(await fs.readFile(schemaPath, "utf8"));
        pushIssue(issues, "ok", `schema.json valid: ${suite.schemaPath}`);
      } catch (error) {
        pushIssue(issues, "error", `Invalid schema JSON at ${suite.schemaPath}: ${error}`);
      }
    }

    const assertionsPath = path.resolve(configDir, suite.assertionsPath);
    if (!(await exists(assertionsPath))) {
      pushIssue(issues, "error", `Missing assertions file: ${assertionsPath}`);
    } else {
      try {
        JSON.parse(await fs.readFile(assertionsPath, "utf8"));
        pushIssue(issues, "ok", `assertions.json valid: ${suite.assertionsPath}`);
      } catch (error) {
        pushIssue(issues, "error", `Invalid assertions JSON at ${suite.assertionsPath}: ${error}`);
      }
    }

    const datasetPath = path.resolve(configDir, suite.datasetPath);
    if (!(await exists(datasetPath))) {
      pushIssue(issues, "error", `Missing dataset file: ${datasetPath}`);
    } else {
      try {
        const dataset = await loadDataset(datasetPath);
        if (dataset.length === 0) {
          pushIssue(issues, "warn", `Dataset has no test cases: ${suite.datasetPath}`);
        } else {
          pushIssue(issues, "ok", `Dataset valid with ${dataset.length} case(s): ${suite.datasetPath}`);
        }
      } catch (error) {
        pushIssue(issues, "error", `Invalid dataset JSONL at ${suite.datasetPath}: ${error}`);
      }
    }

    const toolsPath = path.resolve(configDir, suite.toolsModule);
    if (!(await exists(toolsPath))) {
      pushIssue(issues, "error", `Missing tools module: ${toolsPath}`);
    } else {
      pushIssue(issues, "ok", `Tools module found: ${suite.toolsModule}`);
    }
  }

  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.filter((issue) => issue.level === "warn").length;

  const result: DoctorResult = {
    ok: errors === 0,
    errors,
    warnings,
    issues,
  };

  printIssues(result);
  return result;
}
