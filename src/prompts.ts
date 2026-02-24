import fs from "node:fs/promises";
import path from "node:path";
import { PromptMeta, PromptRecord } from "./types.js";
import { compareSemver, readJsonFile } from "./utils.js";

export function extractVersionFromFilename(name: string): string | null {
  const match = name.match(/^v(.+)\.md$/);
  return match?.[1] ?? null;
}

export async function listPromptVersions(promptDir: string): Promise<string[]> {
  const files = await fs.readdir(promptDir);
  const versions = files
    .map((file) => extractVersionFromFilename(file))
    .filter((item): item is string => Boolean(item))
    .sort(compareSemver);
  return versions;
}

async function detectLatestVersion(promptDir: string): Promise<string | undefined> {
  try {
    const versions = await listPromptVersions(promptDir);
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  } catch {
    return undefined;
  }
}

async function detectVersionFromMeta(promptDir: string): Promise<string | undefined> {
  const metaPath = path.join(promptDir, "meta.json");
  try {
    const meta = await readJsonFile<PromptMeta>(metaPath);
    if (meta.currentVersion) {
      return meta.currentVersion;
    }
    if (Array.isArray(meta.versions) && meta.versions.length > 0) {
      const sorted = [...meta.versions].sort(compareSemver);
      return sorted[sorted.length - 1];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function loadPromptRecord(cwd: string, promptId: string): Promise<PromptRecord> {
  const promptDir = path.resolve(cwd, "prompts", promptId);
  const version = (await detectLatestVersion(promptDir)) ?? (await detectVersionFromMeta(promptDir));
  if (!version) {
    throw new Error(
      `No prompt version found in ${promptDir}. Add files like v1.0.0.md (meta.json is optional).`,
    );
  }

  const filePath = path.join(promptDir, `v${version}.md`);
  const body = await fs.readFile(filePath, "utf8");
  return {
    promptId,
    version,
    body,
  };
}
