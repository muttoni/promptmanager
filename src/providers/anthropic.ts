import {
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderConfig,
  ProviderRequest,
  ToolCallTrace,
} from "../types.js";
import { postJson, toFinalJson } from "./common.js";

function toAnthropicTools(req: ProviderRequest): JsonObject[] {
  return req.tools.map((tool) => {
    const out: JsonObject = {
      name: tool.name,
      input_schema: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
    };
    if (tool.description) {
      out.description = tool.description;
    }
    return out;
  });
}

function extractTextFromContent(content: unknown[]): string {
  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") {
      chunks.push(obj.text);
    }
  }
  return chunks.join("\n").trim();
}

export function createAnthropicAdapter(config?: ProviderConfig): ProviderAdapter {
  const keyEnv = config?.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const baseUrl = config?.baseUrl ?? "https://api.anthropic.com/v1";

  return {
    id: "anthropic",
    async invokeWithTools(req) {
      const apiKey = process.env[keyEnv];
      if (!apiKey) {
        throw new Error(`Missing Anthropic API key in environment variable ${keyEnv}.`);
      }

      const trace: ToolCallTrace[] = [];
      let toolCallsUsed = 0;
      const messages: JsonObject[] = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: typeof req.input === "string" ? req.input : JSON.stringify(req.input),
            },
          ],
        },
      ];

      let latestResponse: JsonObject = {};

      while (true) {
        const body: JsonObject = {
          model: req.model,
          max_tokens: 2048,
          system: req.prompt,
          messages,
          tools: toAnthropicTools(req),
        };

        latestResponse = await postJson(`${baseUrl.replace(/\/$/, "")}/messages`, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body,
          signal: req.signal,
        });

        const content = Array.isArray(latestResponse.content)
          ? (latestResponse.content as unknown[])
          : [];
        const toolUses = content
          .filter((item) => item && typeof item === "object")
          .map((item) => item as Record<string, unknown>)
          .filter((item) => item.type === "tool_use");

        if (toolUses.length === 0) {
          const finalText = extractTextFromContent(content);
          return {
            finalText,
            finalOutput: toFinalJson(finalText),
            usage: (latestResponse.usage as JsonObject | undefined) ?? undefined,
            rawResponse: latestResponse as JsonValue,
            toolTrace: trace,
          };
        }

        if (toolCallsUsed + toolUses.length > req.maxToolCalls) {
          throw new Error(
            `Anthropic tool-calling exceeded maxToolCalls=${req.maxToolCalls}.`,
          );
        }

        toolCallsUsed += toolUses.length;

        messages.push({
          role: "assistant",
          content: content as unknown as JsonValue,
        });

        const toolResults: JsonObject[] = [];
        for (const toolCall of toolUses) {
          const id = String(toolCall.id ?? `call_${Date.now()}`);
          const name = String(toolCall.name ?? "");
          const args = (toolCall.input as JsonValue) ?? {};
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

            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: typeof result.result === "string" ? result.result : JSON.stringify(result.result),
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

        messages.push({
          role: "user",
          content: toolResults,
        });
      }
    },
  };
}
