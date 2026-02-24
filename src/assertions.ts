import fs from "node:fs/promises";
import {
  AssertionCheckResult,
  AssertionOperator,
  AssertionResult,
  AssertionSpec,
  FieldMatcher,
  JsonValue,
  NumericRangeMatcher,
} from "./types.js";
import { asObject, getByPath } from "./utils.js";

export async function loadAssertionSpec(assertionsPath: string): Promise<AssertionSpec> {
  const raw = await fs.readFile(assertionsPath, "utf8");
  const parsed = JSON.parse(raw) as AssertionSpec;

  if (!Array.isArray(parsed.requiredKeys)) {
    throw new Error("Assertion spec must contain an array for 'requiredKeys'.");
  }
  return {
    requiredKeys: parsed.requiredKeys,
    allowAdditionalKeys: parsed.allowAdditionalKeys ?? false,
    variableFields: parsed.variableFields ?? [],
    fieldMatchers: parsed.fieldMatchers ?? {},
  };
}

function resolveExpectedValue(
  matcher: FieldMatcher,
  fieldPath: string,
  expectedOutput: JsonValue,
): JsonValue | NumericRangeMatcher | undefined {
  if (matcher.value !== undefined) {
    return matcher.value;
  }

  if (matcher.expectedPath) {
    const pathValue = matcher.expectedPath.replace(/^\$expected\./, "");
    return getByPath(expectedOutput, pathValue);
  }

  return getByPath(expectedOutput, fieldPath);
}

function runCheck(
  op: AssertionOperator,
  actual: JsonValue | undefined,
  expected: JsonValue | NumericRangeMatcher | undefined,
): { passed: boolean; message: string } {
  switch (op) {
    case "equals": {
      const passed = JSON.stringify(actual) === JSON.stringify(expected);
      return {
        passed,
        message: passed ? "matches expected value" : "value does not match expected",
      };
    }
    case "oneOf": {
      const pool = Array.isArray(expected) ? expected : [];
      const passed = pool.some((candidate) => JSON.stringify(candidate) === JSON.stringify(actual));
      return {
        passed,
        message: passed ? "value matches allowed option" : "value not in allowed set",
      };
    }
    case "contains": {
      if (typeof actual === "string" && typeof expected === "string") {
        const passed = actual.includes(expected);
        return { passed, message: passed ? "substring found" : "substring missing" };
      }
      if (Array.isArray(actual)) {
        const passed = actual.some((item) => JSON.stringify(item) === JSON.stringify(expected));
        return { passed, message: passed ? "array contains value" : "array does not contain value" };
      }
      return { passed: false, message: "contains expects string or array output" };
    }
    case "regex": {
      const pattern = typeof expected === "string" ? expected : "";
      const regex = new RegExp(pattern);
      const passed = regex.test(String(actual ?? ""));
      return { passed, message: passed ? "regex matched" : `regex '${pattern}' did not match` };
    }
    case "numericRange": {
      const range = (expected ?? {}) as NumericRangeMatcher;
      const value = typeof actual === "number" ? actual : Number.NaN;
      const minOk = range.min === undefined || value >= range.min;
      const maxOk = range.max === undefined || value <= range.max;
      const passed = Number.isFinite(value) && minOk && maxOk;
      return {
        passed,
        message: passed
          ? "value in numeric range"
          : `value outside range [${range.min ?? "-inf"}, ${range.max ?? "+inf"}]`,
      };
    }
    case "exists": {
      const passed = actual !== undefined && actual !== null;
      return { passed, message: passed ? "value exists" : "value missing" };
    }
    case "absent": {
      const passed = actual === undefined || actual === null;
      return { passed, message: passed ? "value absent as expected" : "value should be absent" };
    }
    default:
      return { passed: false, message: "unsupported assertion operator" };
  }
}

export function evaluateAssertions(
  output: JsonValue,
  expectedOutput: JsonValue,
  spec: AssertionSpec,
): AssertionResult {
  const outputObj = asObject(output);
  const checks: AssertionCheckResult[] = [];

  const missingKeys = spec.requiredKeys.filter((key) => !(key in outputObj));

  const allowedKeys = new Set<string>([
    ...spec.requiredKeys,
    ...(spec.variableFields ?? []),
    ...Object.keys(spec.fieldMatchers ?? {}),
  ]);

  const unexpectedKeys = (spec.allowAdditionalKeys ?? false)
    ? []
    : Object.keys(outputObj).filter((key) => !allowedKeys.has(key));

  for (const [field, matchers] of Object.entries(spec.fieldMatchers ?? {})) {
    const actualValue = getByPath(output, field);
    for (const matcher of matchers) {
      const expectedValue = resolveExpectedValue(matcher, field, expectedOutput);
      const result = runCheck(matcher.op, actualValue, expectedValue);
      const check: AssertionCheckResult = {
        field,
        op: matcher.op,
        passed: result.passed,
        actual: actualValue,
        message: result.message,
      };
      if (expectedValue !== undefined) {
        check.expected = expectedValue as JsonValue;
      }
      checks.push(check);
    }
  }

  const passed =
    missingKeys.length === 0 &&
    unexpectedKeys.length === 0 &&
    checks.every((check) => check.passed);

  return {
    passed,
    checks,
    missingKeys,
    unexpectedKeys,
  };
}
