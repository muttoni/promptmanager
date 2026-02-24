import fs from "node:fs/promises";
import path from "node:path";
import { PromptMeta, PromptRecord } from "./types.js";
import { compareSemver, readJsonFile } from "./utils.js";

function extractVersionFromFilename(name: string): string | null {
  const match = name.match(/^v(.+)\.md$/);
  return match?.[1] ?? null;
}

async function detectLatestVersion(promptDir: string): Promise<string> {
  const files = await fs.readdir(promptDir);
  const versions = files
    .map((file) => extractVersionFromFilename(file))
    .filter((item): item is string => Boolean(item));

  if (versions.length === 0) {
    throw new Error(`No versioned prompt files found in ${promptDir}. Expected files like v1.0.0.md.`);
  }

  versions.sort(compareSemver);
  return versions[versions.length - 1];
}

export async function loadPromptRecord(cwd: string, promptId: string): Promise<PromptRecord> {
  const promptDir = path.resolve(cwd, "prompts", promptId);
  const metaPath = path.join(promptDir, "meta.json");

  let version: string | undefined;
  try {
    const meta = await readJsonFile<PromptMeta>(metaPath);
    if (meta.currentVersion) {
      version = meta.currentVersion;
    } else if (Array.isArray(meta.versions) && meta.versions.length > 0) {
      const sorted = [...meta.versions].sort(compareSemver);
      version = sorted[sorted.length - 1];
    }
  } catch {
    // meta is optional, fallback to directory scan.
  }

  if (!version) {
    version = await detectLatestVersion(promptDir);
  }

  const filePath = path.join(promptDir, `v${version}.md`);
  const body = await fs.readFile(filePath, "utf8");
  return {
    promptId,
    version,
    body,
  };
}
