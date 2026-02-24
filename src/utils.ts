import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonValue } from "./types.js";

export function hashCaseId(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await ensureDirForFile(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function parseMaybeJson(text: string): JsonValue {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return trimmed;
  }
}

export function redactSensitive(value: JsonValue): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[REDACTED_PHONE]")
      .replace(/\b\d{12,19}\b/g, "[REDACTED_NUMBER]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = redactSensitive(child as JsonValue);
    }
    return out;
  }
  return value;
}

export function getByPath(value: JsonValue, pathValue: string): JsonValue | undefined {
  const tokens = pathValue.split(".").filter(Boolean);
  let current: JsonValue | undefined = value;
  for (const token of tokens) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, JsonValue>)[token];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

export function asObject(value: JsonValue): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
}

export function compareSemver(a: string, b: string): number {
  const aParts = a.split(".").map((item) => Number.parseInt(item, 10) || 0);
  const bParts = b.split(".").map((item) => Number.parseInt(item, 10) || 0);
  const max = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < max; i += 1) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }
  return 0;
}

export async function runPool<T, U>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) {
    return [];
  }
  const capped = Math.max(1, Math.floor(concurrency));
  const results: U[] = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) {
      return;
    }
    results[index] = await worker(items[index], index);
    await next();
  }

  const workers = Array.from({ length: Math.min(capped, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export function shellSplit(command: string): string[] {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return parts.map((part) => part.replace(/^"|"$/g, ""));
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
