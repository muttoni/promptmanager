import path from "node:path";
import {
  AssertionResult,
  JsonObject,
  JsonValue,
  ProviderId,
  RunCaseResult,
  RunConfig,
  RunReport,
  ToolExecutionContext,
} from "./types.js";
import { loadConfig, getSuite } from "./config.js";
import { loadPromptRecord } from "./prompts.js";
import { loadDataset } from "./dataset.js";
import { loadAssertionSpec, evaluateAssertions } from "./assertions.js";
import { loadSchema, validateSchema } from "./schema.js";
import { registerBuiltinProviders, getProvider } from "./providers/registry.js";
import { loadToolModule } from "./tools/loadTools.js";
import { ToolRunner, ToolRunnerError } from "./tools/toolRunner.js";
import { hashCaseId, redactSensitive, runPool, toErrorMessage } from "./utils.js";

function makeEmptyAssertionResult(): AssertionResult {
  return {
    passed: false,
    checks: [],
    missingKeys: [],
    unexpectedKeys: [],
  };
}

function resolvePath(baseDir: string, value: string): string {
  return path.resolve(baseDir, value);
}

function summarize(cases: RunCaseResult[], durationMs: number) {
  return {
    total: cases.length,
    pass: cases.filter((item) => item.status === "pass").length,
    fail: cases.filter((item) => item.status === "fail").length,
    error: cases.filter((item) => item.status === "error").length,
    durationMs,
  };
}

export async function runSuite(runConfig: RunConfig): Promise<RunReport> {
  const cwd = runConfig.cwd ? path.resolve(runConfig.cwd) : process.cwd();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const { path: configPath, config } = await loadConfig(cwd, runConfig.configPath);
  const configDir = path.dirname(configPath);
  const suite = getSuite(config, runConfig.suiteId);

  registerBuiltinProviders(config.providers);

  const providerId: ProviderId = runConfig.provider;
  const provider = getProvider(providerId);
  const model = runConfig.model ?? suite.modelByProvider[providerId];
  if (!model) {
    throw new Error(`No model configured for provider '${providerId}' in suite '${suite.id}'.`);
  }

  const [promptRecord, dataset, assertionSpec, schema, toolModule] = await Promise.all([
    loadPromptRecord(cwd, suite.promptId),
    loadDataset(resolvePath(configDir, suite.datasetPath)),
    loadAssertionSpec(resolvePath(configDir, suite.assertionsPath)),
    loadSchema(resolvePath(configDir, suite.schemaPath)),
    loadToolModule(resolvePath(configDir, suite.toolsModule), cwd),
  ]);

  const toolRunner = new ToolRunner(config.toolRunner, cwd);

  const cases = await runPool(dataset, runConfig.concurrency ?? 4, async (item): Promise<RunCaseResult> => {
    const hashedCaseId = hashCaseId(item.caseId);
    const callContext: ToolExecutionContext = {
      suiteId: suite.id,
      hashedCaseId,
      rawCaseId: item.caseId,
      provider: providerId,
      model,
    };

    const caseStarted = Date.now();

    try {
      const response = await provider.invokeWithTools({
        model,
        prompt: promptRecord.body,
        input: item.input,
        maxToolCalls: config.toolRunner.maxToolCallsPerCase,
        tools: toolModule.tools,
        invokeTool: async (call) => {
          const result = await toolRunner.execute(
            call.name,
            toolModule.resolvedPath,
            call.args,
            callContext,
          );

          return {
            callId: call.id,
            name: call.name,
            result,
          };
        },
      });

      const output = response.finalOutput;
      const schemaResult = validateSchema(schema as JsonObject, output);
      const assertionResult = evaluateAssertions(output, item.expected, assertionSpec);

      const errors = [
        ...schemaResult.errors,
        ...assertionResult.checks
          .filter((check) => !check.passed)
          .map((check) => `${check.field}:${check.op}:${check.message}`),
      ];

      if (assertionResult.missingKeys.length > 0) {
        errors.push(`missing keys: ${assertionResult.missingKeys.join(",")}`);
      }
      if (assertionResult.unexpectedKeys.length > 0) {
        errors.push(`unexpected keys: ${assertionResult.unexpectedKeys.join(",")}`);
      }

      const passed = schemaResult.valid && assertionResult.passed;
      const status: RunCaseResult["status"] = passed ? "pass" : "fail";
      const redactedOutput = config.privacy.redactInReports ? redactSensitive(output) : output;

      return {
        hashedCaseId,
        rawCaseId: "[HASHED]",
        status,
        schemaValid: schemaResult.valid,
        assertionsPassed: assertionResult.passed,
        assertionResult,
        errors,
        output,
        redactedOutput,
        expected: item.expected,
        latencyMs: Date.now() - caseStarted,
        provider: providerId,
        model,
        usage: response.usage,
        toolTrace: config.reporting.includeToolTrace === false ? [] : response.toolTrace,
        tags: item.tags ?? [],
      };
    } catch (error) {
      const err = error as Error;
      const code = error instanceof ToolRunnerError ? error.code : "CASE_ERROR";
      const errors = [`${code}:${toErrorMessage(err)}`];
      return {
        hashedCaseId,
        rawCaseId: "[HASHED]",
        status: "error",
        schemaValid: false,
        assertionsPassed: false,
        assertionResult: makeEmptyAssertionResult(),
        errors,
        output: null,
        redactedOutput: null,
        expected: item.expected,
        latencyMs: Date.now() - caseStarted,
        provider: providerId,
        model,
        usage: undefined,
        toolTrace: [],
        tags: item.tags ?? [],
      };
    }
  });

  const finished = Date.now();
  const warnings: string[] = [];
  if (config.privacy.allowRawProductionFixtures) {
    warnings.push(
      "Raw production fixtures are enabled. Ensure retention and compliance policies are enforced outside PromptManager.",
    );
  }
  if (config.privacy.redactInReports) {
    warnings.push("Report output payloads are redacted by default.");
  }

  return {
    version: "1",
    suiteId: suite.id,
    provider: providerId,
    model,
    startedAt,
    endedAt: new Date(finished).toISOString(),
    summary: summarize(cases, finished - started),
    warnings,
    prompt: {
      promptId: promptRecord.promptId,
      version: promptRecord.version,
    },
    cases,
  };
}
