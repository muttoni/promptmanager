import { JsonObject, JsonValue } from "../types.js";
import { parseMaybeJson } from "../utils.js";

export async function postJson(
  url: string,
  init: {
    headers: Record<string, string>;
    body: JsonObject;
    signal?: AbortSignal;
  },
): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
    body: JSON.stringify(init.body),
    signal: init.signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider request failed (${response.status}): ${text.slice(0, 400)}`);
  }

  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    throw new Error(`Provider returned invalid JSON: ${text.slice(0, 400)}`);
  }
}

export function extractText(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function toFinalJson(text: string): JsonValue {
  return parseMaybeJson(text);
}
