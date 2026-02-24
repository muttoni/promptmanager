import {
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderConfig,
  ProviderRequest,
  ToolCallTrace,
} from "../types.js";
import { postJson, toFinalJson } from "./common.js";

function toGoogleTools(req: ProviderRequest): JsonObject[] {
  const functionDeclarations = req.tools.map((tool) => {
    const declaration: JsonObject = {
      name: tool.name,
      parameters: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
    };
    if (tool.description) {
      declaration.description = tool.description;
    }
    return declaration;
  });

  return [
    {
      functionDeclarations,
    },
  ];
}

function normalizeModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function extractParts(response: JsonObject): Record<string, unknown>[] {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  if (candidates.length === 0) {
    return [];
  }
  const first = candidates[0] as Record<string, unknown>;
  const content =
    first.content && typeof first.content === "object"
      ? (first.content as Record<string, unknown>)
      : {};
  return Array.isArray(content.parts)
    ? (content.parts as Record<string, unknown>[])
    : [];
}

function extractText(parts: Record<string, unknown>[]): string {
  return parts
    .filter((part) => typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n")
    .trim();
}

export function createGoogleAdapter(config?: ProviderConfig): ProviderAdapter {
  const keyEnv = config?.apiKeyEnv ?? "GEMINI_API_KEY";
  const fallbackEnv = "GOOGLE_API_KEY";
  const baseUrl = config?.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";

  return {
    id: "google",
    async invokeWithTools(req) {
      const apiKey = process.env[keyEnv] ?? process.env[fallbackEnv];
      if (!apiKey) {
        throw new Error(`Missing Google API key in ${keyEnv} or ${fallbackEnv}.`);
      }

      const trace: ToolCallTrace[] = [];
      let toolCallsUsed = 0;
      const modelPath = normalizeModelPath(req.model);
      const contents: JsonObject[] = [
        {
          role: "user",
          parts: [{ text: typeof req.input === "string" ? req.input : JSON.stringify(req.input) }],
        },
      ];

      let latestResponse: JsonObject = {};

      while (true) {
        latestResponse = await postJson(
          `${baseUrl.replace(/\/$/, "")}/${modelPath}:generateContent?key=${apiKey}`,
          {
            headers: {},
            body: {
              systemInstruction: { parts: [{ text: req.prompt }] },
              contents,
              tools: toGoogleTools(req),
            },
            signal: req.signal,
          },
        );

        const parts = extractParts(latestResponse);
        const functionCalls = parts
          .map((part) => part.functionCall)
          .filter((item) => item && typeof item === "object") as Record<string, unknown>[];

        if (functionCalls.length === 0) {
          const finalText = extractText(parts);
          return {
            finalText,
            finalOutput: toFinalJson(finalText),
            usage: (latestResponse.usageMetadata as JsonObject | undefined) ?? undefined,
            rawResponse: latestResponse as JsonValue,
            toolTrace: trace,
          };
        }

        if (toolCallsUsed + functionCalls.length > req.maxToolCalls) {
          throw new Error(`Google tool-calling exceeded maxToolCalls=${req.maxToolCalls}.`);
        }

        toolCallsUsed += functionCalls.length;

        for (const call of functionCalls) {
          const id = String(call.id ?? call.name ?? `call_${Date.now()}`);
          const name = String(call.name ?? "");
          const args = (call.args as JsonValue) ?? {};
          const startedAt = Date.now();

          try {
            const result = await req.invokeTool({ id, name, args });
            trace.push({
              id,
              name,
              args,
              result: result.result,
              latencyMs: Date.now() - startedAt,
              status: "ok",
            });

            contents.push({
              role: "model",
              parts: [
                {
                  functionCall: {
                    id,
                    name,
                    args,
                  },
                },
              ],
            });
            contents.push({
              role: "user",
              parts: [
                {
                  functionResponse: {
                    name,
                    response: {
                      result: result.result,
                    },
                  },
                },
              ],
            });
          } catch (error) {
            trace.push({
              id,
              name,
              args,
              latencyMs: Date.now() - startedAt,
              status: "error",
              errorCode: "TOOL_EXECUTION_ERROR",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
      }
    },
  };
}
