import path from "node:path";
import { DiffReport, RunReport, SuggestionReport } from "./types.js";
import { writeJsonFile } from "./utils.js";

function timestampTag(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function defaultRunReportPath(
  cwd: string,
  suiteId: string,
  provider: string,
  outDir = "promptmanager-reports",
): string {
  return path.resolve(cwd, outDir, `${timestampTag()}-${suiteId}-${provider}.json`);
}

export function defaultSuggestionPath(cwd: string, suiteId: string, outDir = "promptmanager-reports"): string {
  return path.resolve(cwd, outDir, `${timestampTag()}-${suiteId}-suggestions.json`);
}

export async function writeRunReport(filePath: string, report: RunReport): Promise<void> {
  await writeJsonFile(filePath, report);
}

export async function writeSuggestionReport(filePath: string, report: SuggestionReport): Promise<void> {
  await writeJsonFile(filePath, report);
}

export function printRunSummary(report: RunReport): void {
  const { summary } = report;
  process.stdout.write(`\nRun complete for suite '${report.suiteId}'\n`);
  process.stdout.write(`Provider/model: ${report.provider}/${report.model}\n`);
  process.stdout.write(`Prompt: ${report.prompt.promptId}@${report.prompt.version}\n`);
  process.stdout.write(
    `Cases: total=${summary.total}, pass=${summary.pass}, fail=${summary.fail}, error=${summary.error}\n`,
  );
  process.stdout.write(`Duration: ${summary.durationMs}ms\n`);

  if (report.warnings.length > 0) {
    process.stdout.write("Warnings:\n");
    for (const warning of report.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
}

export function printDiffSummary(diff: DiffReport): void {
  process.stdout.write("\nDiff summary\n");
  process.stdout.write(`Compared: ${diff.totalCompared}\n`);
  process.stdout.write(`Regressions: ${diff.regressions.length}\n`);
  process.stdout.write(`Improvements: ${diff.improvements.length}\n`);
  process.stdout.write(`Unchanged: ${diff.unchanged}\n`);
}

export function printSuggestionSummary(report: SuggestionReport): void {
  process.stdout.write(`\nGenerated ${report.suggestions.length} suggestion(s)\n`);
  for (const suggestion of report.suggestions) {
    process.stdout.write(`- ${suggestion.title}: ${suggestion.rationale}\n`);
  }
}
