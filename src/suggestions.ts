import { JsonObject, Suggestion, SuggestionInput, SuggestionReport } from "./types.js";

function inferField(errorMessage: string): string {
  const [field] = errorMessage.split(":");
  return field || "unknown";
}

function buildHeuristicSuggestions(input: SuggestionInput): Suggestion[] {
  const failed = input.report.cases.filter((item) => item.status !== "pass");
  if (failed.length === 0) {
    return [
      {
        title: "No action required",
        rationale: "No failing cases were found in the run report.",
        suggestedPatch: "Keep the current prompt version as baseline.",
        impactedFields: [],
      },
    ];
  }

  const grouped = new Map<string, { count: number; messages: string[] }>();
  for (const runCase of failed) {
    for (const error of runCase.errors) {
      const field = inferField(error);
      const current = grouped.get(field) ?? { count: 0, messages: [] };
      current.count += 1;
      current.messages.push(error);
      grouped.set(field, current);
    }
  }

  const ranked = [...grouped.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, input.maxSuggestions ?? 5);

  return ranked.map(([field, details], index) => ({
    title: `Stabilize '${field}' extraction (${index + 1})`,
    rationale: `Field '${field}' is implicated in ${details.count} failing checks.`,
    suggestedPatch:
      `Add or tighten instructions for '${field}', include explicit examples, and constrain output format for this field. ` +
      `Observed errors: ${details.messages.slice(0, 2).join(" | ")}`,
    impactedFields: field === "unknown" ? [] : [field],
  }));
}

async function requestAiSuggestions(input: SuggestionInput): Promise<Suggestion[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const failures = input.report.cases
    .filter((item) => item.status !== "pass")
    .slice(0, 20)
    .map((item) => ({
      id: item.hashedCaseId,
      errors: item.errors,
      assertionFailures: item.assertionResult.checks.filter((check) => !check.passed).slice(0, 3),
    }));

  const body: JsonObject = {
    model: input.aiModel ?? "gpt-5-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a prompt engineer. Generate concise prompt improvement suggestions for extraction regressions. Return JSON array with {title,rationale,suggestedPatch,impactedFields}.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              suiteId: input.report.suiteId,
              prompt: input.report.prompt,
              failures,
              maxSuggestions: input.maxSuggestions ?? 5,
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "suggestion_report",
        schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  rationale: { type: "string" },
                  suggestedPatch: { type: "string" },
                  impactedFields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["title", "rationale", "suggestedPatch", "impactedFields"],
                additionalProperties: false,
              },
            },
          },
          required: ["suggestions"],
          additionalProperties: false,
        },
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const outputText =
    typeof payload.output_text === "string"
      ? payload.output_text
      : Array.isArray(payload.output)
        ? payload.output
            .flatMap((item) => {
              if (!item || typeof item !== "object") {
                return [];
              }
              const content = (item as Record<string, unknown>).content;
              if (!Array.isArray(content)) {
                return [];
              }
              return content
                .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : undefined))
                .filter((value): value is string => typeof value === "string");
            })
            .join("\n")
        : "";

  if (!outputText.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(outputText) as { suggestions?: Suggestion[] };
    if (!Array.isArray(parsed.suggestions)) {
      return null;
    }
    return parsed.suggestions.slice(0, input.maxSuggestions ?? 5);
  } catch {
    return null;
  }
}

export async function generateSuggestions(input: SuggestionInput): Promise<SuggestionReport> {
  let suggestions: Suggestion[] = [];

  if (input.withAi) {
    const aiSuggestions = await requestAiSuggestions(input);
    if (aiSuggestions && aiSuggestions.length > 0) {
      suggestions = aiSuggestions;
    }
  }

  if (suggestions.length === 0) {
    suggestions = buildHeuristicSuggestions(input);
  }

  return {
    generatedAt: new Date().toISOString(),
    suiteId: input.report.suiteId,
    provider: input.report.provider,
    model: input.report.model,
    suggestions,
  };
}
