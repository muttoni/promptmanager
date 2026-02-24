#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runSuite } from "./runSuite.js";
import { diffRuns } from "./diffRuns.js";
import { generateSuggestions } from "./suggestions.js";
import { runInit } from "./cli/init.js";
import { loadConfig } from "./config.js";
import {
  defaultRunReportPath,
  defaultSuggestionPath,
  printDiffSummary,
  printRunSummary,
  printSuggestionSummary,
  writeRunReport,
  writeSuggestionReport,
} from "./reporting.js";
import { RunReport, ProviderId } from "./types.js";
import { readJsonFile } from "./utils.js";

function parseProvider(value: string): ProviderId {
  if (value === "openai" || value === "anthropic" || value === "google") {
    return value;
  }
  throw new Error(`Invalid provider '${value}'. Expected openai|anthropic|google.`);
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function resolveConfiguredOutDir(cwd: string, configPath?: string): Promise<string> {
  try {
    const { path: loadedPath, config } = await loadConfig(cwd, configPath);
    const baseDir = path.dirname(loadedPath);
    return path.resolve(baseDir, config.reporting.outDir ?? "promptmanager-reports");
  } catch {
    return path.resolve(cwd, "promptmanager-reports");
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("promptmgr")
    .description("PromptManager: regression-safe prompt + tool-calling evaluation")
    .version("0.1.0");

  program
    .command("init")
    .description("Initialize PromptManager scaffold in current repo")
    .option("--force", "Overwrite existing scaffold files")
    .action(async (options: { force?: boolean }) => {
      await runInit(process.cwd(), options);
    });

  program
    .command("run")
    .description("Run one suite against a provider/model and emit run report")
    .requiredOption("--suite <suite>", "Suite ID")
    .requiredOption("--provider <provider>", "Provider: openai|anthropic|google")
    .option("--model <model>", "Model override")
    .option("--out <path>", "Output report JSON path")
    .option("--config <path>", "Config path (default: promptmanager.config.ts/json)")
    .option("--concurrency <n>", "Parallel case workers (default: 4)", "4")
    .action(
      async (options: {
        suite: string;
        provider: string;
        model?: string;
        out?: string;
        config?: string;
        concurrency: string;
      }) => {
        const provider = parseProvider(options.provider);
        const report = await runSuite({
          suiteId: options.suite,
          provider,
          model: options.model,
          outPath: options.out,
          configPath: options.config,
          cwd: process.cwd(),
          concurrency: toInt(options.concurrency, 4),
        });

        printRunSummary(report);
        const outDir = await resolveConfiguredOutDir(process.cwd(), options.config);
        const outPath = options.out
          ? path.resolve(process.cwd(), options.out)
          : defaultRunReportPath(process.cwd(), options.suite, provider, outDir);
        await writeRunReport(outPath, report);
        process.stdout.write(`Run report written: ${outPath}\n`);
      },
    );

  program
    .command("diff")
    .description("Diff baseline vs candidate run reports")
    .requiredOption("--baseline <path>", "Baseline report path")
    .requiredOption("--candidate <path>", "Candidate report path")
    .action(async (options: { baseline: string; candidate: string }) => {
      const baseline = await readJsonFile<RunReport>(path.resolve(process.cwd(), options.baseline));
      const candidate = await readJsonFile<RunReport>(path.resolve(process.cwd(), options.candidate));
      const diff = diffRuns(baseline, candidate);
      printDiffSummary(diff);
      process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
    });

  program
    .command("ci")
    .description("Run suite and fail on regression against a baseline")
    .requiredOption("--suite <suite>", "Suite ID")
    .requiredOption("--provider <provider>", "Provider: openai|anthropic|google")
    .requiredOption("--baseline <path>", "Baseline report path")
    .option("--model <model>", "Model override")
    .option("--config <path>", "Config path")
    .option("--out <path>", "Candidate report output path")
    .option("--fail-on-regression", "Fail CI when regressions exist", true)
    .option("--concurrency <n>", "Parallel case workers (default: 4)", "4")
    .action(
      async (options: {
        suite: string;
        provider: string;
        baseline: string;
        model?: string;
        config?: string;
        out?: string;
        failOnRegression?: boolean;
        concurrency: string;
      }) => {
        const provider = parseProvider(options.provider);
        const candidate = await runSuite({
          suiteId: options.suite,
          provider,
          model: options.model,
          configPath: options.config,
          cwd: process.cwd(),
          concurrency: toInt(options.concurrency, 4),
        });
        printRunSummary(candidate);
        const outDir = await resolveConfiguredOutDir(process.cwd(), options.config);

        const candidatePath = options.out
          ? path.resolve(process.cwd(), options.out)
          : defaultRunReportPath(process.cwd(), options.suite, provider, outDir);
        await writeRunReport(candidatePath, candidate);
        process.stdout.write(`Candidate run report written: ${candidatePath}\n`);

        const baseline = await readJsonFile<RunReport>(path.resolve(process.cwd(), options.baseline));
        const diff = diffRuns(baseline, candidate);
        printDiffSummary(diff);

        if ((options.failOnRegression ?? true) && diff.regressions.length > 0) {
          process.stderr.write(`CI failed: ${diff.regressions.length} regressions detected.\n`);
          process.exitCode = 1;
          return;
        }

        process.stdout.write("CI check passed.\n");
      },
    );

  program
    .command("suggest")
    .description("Generate prompt improvement suggestions from a run report")
    .requiredOption("--run <path>", "Run report path")
    .option("--out <path>", "Output suggestion report path")
    .option("--with-ai", "Use AI suggestion generation when OPENAI_API_KEY is available", false)
    .option("--model <model>", "Suggestion model override")
    .option("--max <n>", "Max number of suggestions", "5")
    .action(
      async (options: {
        run: string;
        out?: string;
        withAi?: boolean;
        model?: string;
        max: string;
      }) => {
        const report = await readJsonFile<RunReport>(path.resolve(process.cwd(), options.run));
        const suggestions = await generateSuggestions({
          report,
          maxSuggestions: toInt(options.max, 5),
          withAi: options.withAi ?? false,
          aiModel: options.model,
        });

        printSuggestionSummary(suggestions);
        const outPath = options.out
          ? path.resolve(process.cwd(), options.out)
          : defaultSuggestionPath(process.cwd(), report.suiteId);
        await writeSuggestionReport(outPath, suggestions);
        process.stdout.write(`Suggestion report written: ${outPath}\n`);
      },
    );

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`promptmgr failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
