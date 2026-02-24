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
npm install @rekshaw/promptmanager
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
promptmgr add-suite refund-email-parser
promptmgr add-case refund-email-parser --input '{"email":"raw"}' --expected '{"field":"value"}'
promptmgr prompt bump refund-email-parser
promptmgr doctor
```

## Add many prompts fast

When teams already have many prompts, use `add-suite` to scaffold each new suite without hand-editing folders/files:

```bash
promptmgr add-suite refund-email-parser
promptmgr add-suite booking-change-parser --from-suite customer-email-parser
promptmgr add-suite loyalty-upgrade-parser --prompt-id loyalty-upgrade
```

What it does:

- Appends a new suite entry into `promptmanager.config.ts` or `.json`
- Creates `prompts/<promptId>/v1.0.0.md`
- Creates `evals/<suiteId>/dataset.jsonl`, `schema.json`, and `assertions.json`
- Reuses `toolsModule` and model defaults from an existing suite template

Useful options:

- `--from-suite <suiteId>`: choose which existing suite to copy defaults from
- `--prompt-id <promptId>`: set a different prompt ID from suite ID
- `--config <path>`: target a non-default config file
- `--force`: overwrite scaffold files if they already exist

## Easier versioning

`meta.json` is optional. PromptManager auto-picks the latest `v*.md` file.

To make a new prompt version:

```bash
promptmgr prompt bump customer-email-parser
promptmgr prompt bump customer-email-parser --part minor
```

This creates the next file (for example `v1.0.1.md`) by copying the latest prompt body.

## Add eval cases quickly

Append one case without manually editing JSONL:

```bash
promptmgr add-case customer-email-parser \
  --case-id customer-email-002 \
  --input '{"subject":"...","body":"..."}' \
  --expected '{"customer_email":"x@y.com","reservation_code":"ABC123","departure_date":"2026-04-18","fare_type_raw":"Economy Flex","fare_type_normalized":"ECONOMY_FLEX"}' \
  --tags smoke,happy-path
```

Or load input/expected from files:

```bash
promptmgr add-case customer-email-parser --input-file ./tmp/input.json --expected-file ./tmp/expected.json
```

## Setup health checks

Validate config + suite files before running evals:

```bash
promptmgr doctor
promptmgr doctor --suite customer-email-parser
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
import type { ToolModuleShape } from "@rekshaw/promptmanager";

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
import { runSuite, diffRuns, generateSuggestions } from "@rekshaw/promptmanager";
```

## Development

```bash
npm ci
npm run build
npm test
```
