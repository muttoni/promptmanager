import path from "node:path";
import { pathToFileURL } from "node:url";
import { JsonObject, ToolDefinition, ToolModuleShape } from "../types.js";

function normalizeTools(raw: unknown): ToolDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const tool = item as Record<string, unknown>;
      let inputSchema: JsonObject | undefined;
      if (tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)) {
        inputSchema = tool.inputSchema as JsonObject;
      }
      return {
        name: String(tool.name),
        description: typeof tool.description === "string" ? tool.description : undefined,
        inputSchema,
        strict: typeof tool.strict === "boolean" ? tool.strict : undefined,
      };
    });
}

export async function loadToolModule(toolsModulePath: string, cwd: string): Promise<{ resolvedPath: string; tools: ToolDefinition[] }> {
  const resolvedPath = path.resolve(cwd, toolsModulePath);
  const moduleUrl = `${pathToFileURL(resolvedPath).href}?v=${Date.now()}`;
  const mod = (await import(moduleUrl)) as Partial<ToolModuleShape>;
  const tools = normalizeTools(mod.tools);
  return { resolvedPath, tools };
}
