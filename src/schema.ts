import fs from "node:fs/promises";
import AjvImport from "ajv";
import { JsonObject, JsonValue } from "./types.js";

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

const AjvCtor = (AjvImport as unknown as { default?: new (options?: unknown) => AjvInstance }).default
  ?? (AjvImport as unknown as new (options?: unknown) => AjvInstance);

interface AjvValidateFn {
  (payload: unknown): boolean;
  errors?: Array<{ instancePath?: string; message?: string }>;
}

interface AjvInstance {
  compile: (schema: unknown) => AjvValidateFn;
}

const ajv = new AjvCtor({ allErrors: true, strict: false });

export async function loadSchema(schemaPath: string): Promise<JsonObject> {
  const raw = await fs.readFile(schemaPath, "utf8");
  return JSON.parse(raw) as JsonObject;
}

export function validateSchema(schema: JsonObject, payload: JsonValue): SchemaValidationResult {
  const validate = ajv.compile(schema);
  const valid = validate(payload);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors ?? []).map((error) => {
    const pointer = error.instancePath || "(root)";
    return `${pointer} ${error.message ?? "schema violation"}`;
  });
  return { valid: false, errors };
}
