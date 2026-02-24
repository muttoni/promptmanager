import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiAdapter } from "../src/providers/openai.js";
import { createAnthropicAdapter } from "../src/providers/anthropic.js";
import { createGoogleAdapter } from "../src/providers/google.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

describe("provider adapters contract", () => {
  it("openai adapter runs tool-calling loop and returns parsed final output", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "resp-1",
          output: [
            {
              type: "reasoning",
              id: "rs_1",
              summary: [],
              content: [],
            },
            {
              type: "function_call",
              call_id: "call-1",
              name: "normalize_status",
              arguments: JSON.stringify({ raw_status: "Confirmed" }),
            },
          ],
          usage: { total_tokens: 10 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "resp-2",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"booking_status":"confirmed"}' }],
            },
          ],
          output_text: '{"booking_status":"confirmed"}',
          usage: { total_tokens: 20 },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const invokeTool = vi.fn(async () => ({
      callId: "call-1",
      name: "normalize_status",
      result: { status: "confirmed" },
    }));

    const adapter = createOpenAiAdapter();
    const response = await adapter.invokeWithTools({
      model: "gpt-test",
      prompt: "Extract fields",
      input: { body: "booking confirmed" },
      tools: [{ name: "normalize_status" }],
      maxToolCalls: 5,
      invokeTool,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(response.toolTrace).toHaveLength(1);
    expect(response.finalOutput).toEqual({ booking_status: "confirmed" });

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    const tools = Array.isArray(firstRequest.tools) ? firstRequest.tools : [];
    expect((tools[0] as { strict?: boolean }).strict).toBe(true);

    const secondInput = Array.isArray(secondRequest.input) ? secondRequest.input : [];
    expect(
      secondInput.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "reasoning"),
    ).toBe(true);
    expect(
      secondInput.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as { type?: string }).type === "function_call_output" &&
          (item as { call_id?: string }).call_id === "call-1",
      ),
    ).toBe(true);
  });

  it("anthropic adapter runs tool-calling loop and returns parsed final output", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "normalize_status",
              input: { raw_status: "Confirmed" },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          content: [{ type: "text", text: '{"booking_status":"confirmed"}' }],
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const invokeTool = vi.fn(async () => ({
      callId: "toolu_1",
      name: "normalize_status",
      result: { status: "confirmed" },
    }));

    const adapter = createAnthropicAdapter();
    const response = await adapter.invokeWithTools({
      model: "claude-test",
      prompt: "Extract fields",
      input: { body: "booking confirmed" },
      tools: [{ name: "normalize_status" }],
      maxToolCalls: 5,
      invokeTool,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(response.toolTrace).toHaveLength(1);
    expect(response.finalOutput).toEqual({ booking_status: "confirmed" });
  });

  it("google adapter runs tool-calling loop and returns parsed final output", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      id: "fc_1",
                      name: "normalize_status",
                      args: { raw_status: "Confirmed" },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 10 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: '{"booking_status":"confirmed"}' }],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 20 },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const invokeTool = vi.fn(async () => ({
      callId: "fc_1",
      name: "normalize_status",
      result: { status: "confirmed" },
    }));

    const adapter = createGoogleAdapter();
    const response = await adapter.invokeWithTools({
      model: "gemini-test",
      prompt: "Extract fields",
      input: { body: "booking confirmed" },
      tools: [{ name: "normalize_status" }],
      maxToolCalls: 5,
      invokeTool,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(response.toolTrace).toHaveLength(1);
    expect(response.finalOutput).toEqual({ booking_status: "confirmed" });
  });
});
