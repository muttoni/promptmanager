# PromptManager

PromptManager is a Node/TypeScript CLI + SDK for regression-safe prompt development with real tool-calling.

## What it does

- Version prompts in Git (`prompts/<promptId>/v<semver>.md`)
- Run eval suites from JSONL fixtures
- Execute real tool handlers in subprocess isolation
- Validate outputs with JSON Schema + field-level assertions
- Diff candidate runs against baseline reports and fail CI on regressions
- Generate non-blocking prompt improvement suggestions

## Install

```bash
npm install promptmanager
```

## Initialize

```bash
npx promptmgr init
```

This creates:

- `promptmanager.config.ts`
- `prompts/customer-email-parser/*`
- `evals/customer-email/*`
- `tools/customer-email-tools.mjs`
- `.github/workflows/promptmanager.yml`

A reusable workflow template is also included at `templates/promptmanager.workflow.yml`.

## CLI

```bash
promptmgr run --suite customer-email-parser --provider openai
promptmgr diff --baseline ./baseline.json --candidate ./candidate.json
promptmgr ci --suite customer-email-parser --provider openai --baseline ./baseline/run-report.json --fail-on-regression
promptmgr suggest --run ./candidate.json --with-ai
```

## Config contract

`promptmanager.config.ts` (or `.json`) must include:

- `providers`
- `suites`
- `toolRunner`
- `privacy`
- `reporting`

## Tool module contract

```ts
import type { ToolModuleShape } from "promptmanager";

export const tools: ToolModuleShape["tools"] = [
  {
    name: "my_tool",
    description: "Tool description",
    strict: true,
    inputSchema: {
      type: "object",
      properties: { foo: { type: "string" } },
      required: ["foo"],
      additionalProperties: false
    }
  }
];

export const handlers: ToolModuleShape["handlers"] = {
  async my_tool(args, context) {
    return { ok: true };
  }
};
```

## OpenAI function-calling workflow support

PromptManager's OpenAI adapter follows the same loop as the official function-calling guide:

1. Send `input + tools` to `responses.create`
2. Read `response.output` items
3. Execute each `function_call` in your app code
4. Append `function_call_output` items to the running `input`
5. Call `responses.create` again until no more function calls remain

For reasoning models, this preserves the full output items across turns (including reasoning/tool call items), matching the documented requirement.

Customer-email parsing with fare normalization is scaffolded by default. To use your existing fare mapper, replace the local function in `tools/customer-email-tools.mjs` with an import from your codebase.

## Report artifacts

Each run emits a JSON artifact with:

- summary counts
- per-case status (`pass|fail|error`)
- schema/assertion failures
- tool-call traces
- hashed case IDs

## SDK usage

```ts
import { runSuite, diffRuns, generateSuggestions } from "promptmanager";
```

## Development

```bash
npm ci
npm run build
npm test
```
