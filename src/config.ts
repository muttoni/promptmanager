import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { PromptManagerConfig, ProviderId } from "./types.js";
import { readJsonFile } from "./utils.js";

const DEFAULT_CONFIG_FILES = ["promptmanager.config.ts", "promptmanager.config.json"];
const PROVIDERS: ProviderId[] = ["openai", "anthropic", "google"];

export async function findConfigPath(cwd: string, explicitPath?: string): Promise<string> {
  if (explicitPath) {
    return path.resolve(cwd, explicitPath);
  }

  for (const candidate of DEFAULT_CONFIG_FILES) {
    const resolved = path.resolve(cwd, candidate);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      // continue
    }
  }

  throw new Error(
    `No config file found. Expected one of: ${DEFAULT_CONFIG_FILES.join(", ")} in ${cwd}`,
  );
}

async function loadTsConfig(filePath: string): Promise<PromptManagerConfig> {
  const source = await fs.readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filePath,
  });

  const sandboxModule: { exports: unknown } = { exports: {} };
  const sandboxExports = sandboxModule.exports as Record<string, unknown>;
  const sandbox: Record<string, unknown> = {
    module: sandboxModule,
    exports: sandboxExports,
    require: createRequire(filePath),
    process,
    console,
    __dirname: path.dirname(filePath),
    __filename: filePath,
  };

  const script = new vm.Script(transpiled.outputText, { filename: filePath });
  const context = vm.createContext(sandbox);
  script.runInContext(context);

  const exported = sandboxModule.exports as { default?: PromptManagerConfig } | PromptManagerConfig;
  if ((exported as { default?: PromptManagerConfig }).default) {
    return (exported as { default: PromptManagerConfig }).default;
  }
  return exported as PromptManagerConfig;
}

function assertConfig(config: PromptManagerConfig): void {
  const missing: string[] = [];
  if (!config || typeof config !== "object") {
    throw new Error("Config must export an object.");
  }
  if (!config.providers) {
    missing.push("providers");
  }
  if (!config.suites) {
    missing.push("suites");
  }
  if (!config.toolRunner) {
    missing.push("toolRunner");
  }
  if (!config.privacy) {
    missing.push("privacy");
  }
  if (!config.reporting) {
    missing.push("reporting");
  }
  if (missing.length > 0) {
    throw new Error(`Config is missing required top-level keys: ${missing.join(", ")}`);
  }
  if (!Array.isArray(config.suites) || config.suites.length === 0) {
    throw new Error("Config.suites must be a non-empty array.");
  }
  for (const provider of PROVIDERS) {
    if (!(provider in config.providers)) {
      throw new Error(`Config.providers must include '${provider}'.`);
    }
  }
  if (config.toolRunner.mode !== "subprocess") {
    throw new Error("Config.toolRunner.mode must be 'subprocess'.");
  }
  if (!config.toolRunner.command) {
    throw new Error("Config.toolRunner.command is required.");
  }
}

export async function loadConfig(cwd: string, explicitPath?: string): Promise<{ path: string; config: PromptManagerConfig }> {
  const configPath = await findConfigPath(cwd, explicitPath);
  const ext = path.extname(configPath);
  let config: PromptManagerConfig;

  if (ext === ".json") {
    config = await readJsonFile<PromptManagerConfig>(configPath);
  } else if (ext === ".ts") {
    config = await loadTsConfig(configPath);
  } else {
    throw new Error(`Unsupported config extension '${ext}'.`);
  }

  assertConfig(config);
  return { path: configPath, config };
}

export function getSuite(config: PromptManagerConfig, suiteId: string) {
  const suite = config.suites.find((item) => item.id === suiteId);
  if (!suite) {
    const available = config.suites.map((item) => item.id).join(", ");
    throw new Error(`Unknown suite '${suiteId}'. Available suites: ${available}`);
  }
  return suite;
}
