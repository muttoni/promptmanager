import { describe, expect, it } from "vitest";
import { evaluateAssertions } from "../src/assertions.js";

describe("evaluateAssertions", () => {
  it("passes with strict required keys and field matchers", () => {
    const output = {
      confirmation_code: "ABC123",
      booking_status: "confirmed",
      check_in_date: "2026-03-10",
    };

    const expected = {
      confirmation_code: "ABC123",
      booking_status: "confirmed",
      check_in_date: "2026-03-10",
    };

    const spec = {
      requiredKeys: ["confirmation_code", "booking_status", "check_in_date"],
      allowAdditionalKeys: false,
      variableFields: [],
      fieldMatchers: {
        confirmation_code: [{ op: "regex", value: "^[A-Z0-9]{6}$" }],
        booking_status: [{ op: "oneOf", value: ["confirmed", "pending"] }],
        check_in_date: [{ op: "equals" }],
      },
    } as const;

    const result = evaluateAssertions(output, expected, spec);
    expect(result.passed).toBe(true);
    expect(result.missingKeys).toEqual([]);
    expect(result.unexpectedKeys).toEqual([]);
  });

  it("fails when required key is missing and extra key exists", () => {
    const output = {
      confirmation_code: "ABC123",
      extra: "not allowed",
    };

    const spec = {
      requiredKeys: ["confirmation_code", "booking_status"],
      allowAdditionalKeys: false,
      fieldMatchers: {
        confirmation_code: [{ op: "exists" }],
      },
    };

    const result = evaluateAssertions(output, {}, spec);
    expect(result.passed).toBe(false);
    expect(result.missingKeys).toEqual(["booking_status"]);
    expect(result.unexpectedKeys).toEqual(["extra"]);
  });

  it("supports numericRange and absent operators", () => {
    const output = { score: 0.92, debug: null };
    const spec = {
      requiredKeys: ["score"],
      fieldMatchers: {
        score: [{ op: "numericRange", value: { min: 0.9, max: 1.0 } }],
        debug: [{ op: "absent" }],
      },
    };

    const result = evaluateAssertions(output, {}, spec);
    expect(result.passed).toBe(true);
  });
});
