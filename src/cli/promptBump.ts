import fs from "node:fs/promises";
import path from "node:path";
import { getSuite, loadConfig } from "../config.js";
import { listPromptVersions } from "../prompts.js";
import { PromptMeta } from "../types.js";
import { readJsonFile, writeJsonFile } from "../utils.js";

export interface PromptBumpOptions {
  part?: "patch" | "minor" | "major";
  config?: string;
  force?: boolean;
}

function parseSemver(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(
      `Unsupported version '${version}'. Use x.y.z (for example 1.0.0) for prompt files.`,
    );
  }
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ];
}

function formatSemver([major, minor, patch]: [number, number, number]): string {
  return `${major}.${minor}.${patch}`;
}

function bumpSemver(version: string, part: "patch" | "minor" | "major"): string {
  const [major, minor, patch] = parseSemver(version);
  if (part === "major") {
    return formatSemver([major + 1, 0, 0]);
  }
  if (part === "minor") {
    return formatSemver([major, minor + 1, 0]);
  }
  return formatSemver([major, minor, patch + 1]);
}

async function updateMetaIfPresent(metaPath: string, version: string): Promise<boolean> {
  try {
    const meta = await readJsonFile<PromptMeta>(metaPath);
    const versions = new Set<string>(Array.isArray(meta.versions) ? meta.versions : []);
    versions.add(version);
    const updated: PromptMeta = {
      ...meta,
      currentVersion: version,
      versions: [...versions],
    };
    await writeJsonFile(metaPath, updated);
    return true;
  } catch {
    return false;
  }
}

function starterPrompt(suiteId: string): string {
  return `You extract structured data for suite '${suiteId}'.

Rules:
1. Return valid JSON only.
2. Use tool-calling only when needed.
3. Return null for missing fields.
`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runPromptBump(cwd: string, suiteId: string, options: PromptBumpOptions): Promise<void> {
  const resolvedCwd = path.resolve(cwd);
  const { config } = await loadConfig(resolvedCwd, options.config);
  const suite = getSuite(config, suiteId);

  const promptDir = path.resolve(resolvedCwd, "prompts", suite.promptId);
  await fs.mkdir(promptDir, { recursive: true });

  const versions = await listPromptVersions(promptDir);
  const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;

  const part = options.part ?? "patch";
  const nextVersion = latest ? bumpSemver(latest, part) : "1.0.0";

  const sourceContent = latest
    ? await fs.readFile(path.join(promptDir, `v${latest}.md`), "utf8")
    : starterPrompt(suiteId);

  const targetPath = path.join(promptDir, `v${nextVersion}.md`);
  if (!options.force && (await pathExists(targetPath))) {
    throw new Error(
      `Prompt version v${nextVersion}.md already exists for prompt '${suite.promptId}'. Use --force to overwrite.`,
    );
  }

  const finalContent = sourceContent.endsWith("\n") ? sourceContent : `${sourceContent}\n`;
  await fs.writeFile(targetPath, finalContent, "utf8");

  const metaUpdated = await updateMetaIfPresent(path.join(promptDir, "meta.json"), nextVersion);

  process.stdout.write(`Created ${targetPath}\n`);
  if (latest) {
    process.stdout.write(`Bumped prompt version: ${latest} -> ${nextVersion} (${part})\n`);
  } else {
    process.stdout.write(`Created initial prompt version: ${nextVersion}\n`);
  }

  if (!metaUpdated) {
    process.stdout.write("meta.json not found (or unreadable); this is OK because latest v*.md is auto-detected.\n");
  }
}
