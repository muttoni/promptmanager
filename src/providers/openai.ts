import {
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderConfig,
  ProviderRequest,
  ToolCallTrace,
} from "../types.js";
import { postJson, toFinalJson } from "./common.js";

function parseArgs(raw: unknown): JsonValue {
  if (typeof raw !== "string") {
    return (raw as JsonValue) ?? null;
  }
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

function toInitialInput(input: JsonValue): JsonObject[] {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: typeof input === "string" ? input : JSON.stringify(input),
        },
      ],
    },
  ];
}

function getOutputItems(response: JsonObject): JsonObject[] {
  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .filter((item) => item && typeof item === "object")
    .map((item) => item as JsonObject);
}

function getFunctionCalls(outputItems: JsonObject[]): JsonObject[] {
  return outputItems.filter((item) => item.type === "function_call");
}

function extractOutputText(response: JsonObject): string {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const outputItems = getOutputItems(response);
  const chunks: string[] = [];

  for (const item of outputItems) {
    if (item.type !== "message") {
      continue;
    }

    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const obj = block as Record<string, unknown>;
      if (obj.type === "output_text" && typeof obj.text === "string") {
        chunks.push(obj.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

async function callOpenAi(
  baseUrl: string,
  apiKey: string,
  body: JsonObject,
  signal?: AbortSignal,
): Promise<JsonObject> {
  return postJson(`${baseUrl.replace(/\/$/, "")}/responses`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
    signal,
  });
}

function toOpenAiTools(req: ProviderRequest): JsonObject[] {
  return req.tools.map((tool) => {
    const out: JsonObject = {
      type: "function",
      name: tool.name,
      parameters: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
      strict: tool.strict ?? true,
    };
    if (tool.description) {
      out.description = tool.description;
    }
    return out;
  });
}

export function createOpenAiAdapter(config?: ProviderConfig): ProviderAdapter {
  const keyEnv = config?.apiKeyEnv ?? "OPENAI_API_KEY";
  const baseUrl = config?.baseUrl ?? "https://api.openai.com/v1";

  return {
    id: "openai",
    async invokeWithTools(req) {
      const apiKey = process.env[keyEnv];
      if (!apiKey) {
        throw new Error(`Missing OpenAI API key in environment variable ${keyEnv}.`);
      }

      let inputList = toInitialInput(req.input);
      const trace: ToolCallTrace[] = [];
      let toolCallsUsed = 0;
      let latestResponse: JsonObject = {};

      while (true) {
        const body: JsonObject = {
          model: req.model,
          instructions: req.prompt,
          input: inputList,
          tools: toOpenAiTools(req),
        };

        if (config?.toolChoice !== undefined) {
          body.tool_choice = config.toolChoice;
        }
        if (config?.parallelToolCalls !== undefined) {
          body.parallel_tool_calls = config.parallelToolCalls;
        }

        latestResponse = await callOpenAi(baseUrl, apiKey, body, req.signal);

        const outputItems = getOutputItems(latestResponse);
        inputList = [...inputList, ...outputItems];

        const functionCalls = getFunctionCalls(outputItems);
        if (functionCalls.length === 0) {
          break;
        }

        if (toolCallsUsed + functionCalls.length > req.maxToolCalls) {
          throw new Error(`OpenAI tool-calling exceeded maxToolCalls=${req.maxToolCalls}.`);
        }

        toolCallsUsed += functionCalls.length;

        for (const call of functionCalls) {
          const callId = String(call.call_id ?? call.id ?? `call_${Date.now()}`);
          const toolName = String(call.name ?? "");
          const args = parseArgs(call.arguments);
          const startedAt = Date.now();

          try {
            const toolResult = await req.invokeTool({
              id: callId,
              name: toolName,
              args,
            });

            trace.push({
              id: callId,
              name: toolName,
              args,
              result: toolResult.result,
              latencyMs: Date.now() - startedAt,
              status: "ok",
            });

            inputList.push({
              type: "function_call_output",
              call_id: callId,
              output:
                typeof toolResult.result === "string"
                  ? toolResult.result
                  : JSON.stringify(toolResult.result),
            });
          } catch (error) {
            trace.push({
              id: callId,
              name: toolName,
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

      const finalText = extractOutputText(latestResponse);
      return {
        finalText,
        finalOutput: toFinalJson(finalText),
        usage: (latestResponse.usage as JsonObject | undefined) ?? undefined,
        rawResponse: latestResponse as JsonValue,
        toolTrace: trace,
      };
    },
  };
}
