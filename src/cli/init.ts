import fs from "node:fs/promises";
import path from "node:path";

interface InitOptions {
  force?: boolean;
}

interface ScaffoldFile {
  filePath: string;
  content: string;
}

async function writeFileSafe(file: ScaffoldFile, force: boolean): Promise<"created" | "skipped"> {
  await fs.mkdir(path.dirname(file.filePath), { recursive: true });
  if (!force) {
    try {
      await fs.access(file.filePath);
      return "skipped";
    } catch {
      // file missing
    }
  }
  await fs.writeFile(file.filePath, file.content, "utf8");
  return "created";
}

function filesForCwd(cwd: string): ScaffoldFile[] {
  return [
    {
      filePath: path.resolve(cwd, "promptmanager.config.ts"),
      content: `import type { PromptManagerConfig } from "@rekshaw/promptmanager";

const config: PromptManagerConfig = {
  providers: {
    openai: {
      apiKeyEnv: "OPENAI_API_KEY",
      parallelToolCalls: false,
      toolChoice: "auto"
    },
    anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
    google: { apiKeyEnv: "GEMINI_API_KEY" }
  },
  suites: [
    {
      id: "customer-email-parser",
      promptId: "customer-email-parser",
      datasetPath: "evals/customer-email/dataset.jsonl",
      schemaPath: "evals/customer-email/schema.json",
      assertionsPath: "evals/customer-email/assertions.json",
      toolsModule: "tools/customer-email-tools.mjs",
      modelByProvider: {
        openai: "gpt-5-mini",
        anthropic: "claude-3-5-sonnet-latest",
        google: "gemini-2.0-flash"
      }
    }
  ],
  toolRunner: {
    mode: "subprocess",
    command: "node",
    envAllowlist: ["TZ"],
    timeoutMs: 5000,
    maxToolCallsPerCase: 8
  },
  privacy: {
    allowRawProductionFixtures: true,
    redactInReports: true,
    encryptionAtRest: false
  },
  reporting: {
    includeToolTrace: true,
    outDir: "promptmanager-reports"
  }
};

export default config;
`,
    },
    {
      filePath: path.resolve(cwd, "prompts/customer-email-parser/meta.json"),
      content: `${JSON.stringify({ currentVersion: "1.0.0", versions: ["1.0.0"] }, null, 2)}\n`,
    },
    {
      filePath: path.resolve(cwd, "prompts/customer-email-parser/v1.0.0.md"),
      content: `You extract structured booking data from customer confirmation emails.

Rules:
1. Return only valid JSON. No markdown. No prose.
2. If the email contains a fare label, call the normalize_fare_type function.
3. Set fare_type_normalized from the function output.
4. If a field is missing, return null for that field.

Required output fields:
- customer_email
- reservation_code
- departure_date
- fare_type_raw
- fare_type_normalized
`,
    },
    {
      filePath: path.resolve(cwd, "evals/customer-email/dataset.jsonl"),
      content: [
        JSON.stringify({
          caseId: "customer-email-001",
          input: {
            subject: "Your flight is confirmed",
            body: "Hello Andrea, thanks for booking with us. Reservation ZX81Y is confirmed. Passenger fare type: Economy Flex. Departure date: 2026-04-18. Contact: andrea@example.com"
          },
          expected: {
            customer_email: "andrea@example.com",
            reservation_code: "ZX81Y",
            departure_date: "2026-04-18",
            fare_type_raw: "Economy Flex",
            fare_type_normalized: "ECONOMY_FLEX"
          },
          tags: ["happy-path", "fare-normalization"]
        }),
      ].join("\n") + "\n",
    },
    {
      filePath: path.resolve(cwd, "evals/customer-email/schema.json"),
      content: `${JSON.stringify(
        {
          type: "object",
          properties: {
            customer_email: { type: ["string", "null"] },
            reservation_code: { type: ["string", "null"] },
            departure_date: { type: ["string", "null"] },
            fare_type_raw: { type: ["string", "null"] },
            fare_type_normalized: { type: ["string", "null"] }
          },
          required: [
            "customer_email",
            "reservation_code",
            "departure_date",
            "fare_type_raw",
            "fare_type_normalized"
          ],
          additionalProperties: false
        },
        null,
        2,
      )}\n`,
    },
    {
      filePath: path.resolve(cwd, "evals/customer-email/assertions.json"),
      content: `${JSON.stringify(
        {
          requiredKeys: [
            "customer_email",
            "reservation_code",
            "departure_date",
            "fare_type_raw",
            "fare_type_normalized"
          ],
          allowAdditionalKeys: false,
          variableFields: [],
          fieldMatchers: {
            customer_email: [{ op: "regex", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" }],
            reservation_code: [{ op: "regex", value: "^[A-Z0-9-]{4,12}$" }],
            departure_date: [{ op: "regex", value: "^\\d{4}-\\d{2}-\\d{2}$" }],
            fare_type_normalized: [{ op: "oneOf", value: ["ECONOMY_BASIC", "ECONOMY_FLEX", "PREMIUM_ECONOMY", "BUSINESS", "FIRST", "UNKNOWN"] }]
          }
        },
        null,
        2,
      )}\n`,
    },
    {
      filePath: path.resolve(cwd, "tools/customer-email-tools.mjs"),
      content: `// Replace this local mapper with an import from your codebase if you already have one.
// Example: import { mapFareType } from "../src/domain/fares/mapFareType.js";

const FARE_TYPE_MAP = {
  "economy basic": "ECONOMY_BASIC",
  "economy flex": "ECONOMY_FLEX",
  "premium economy": "PREMIUM_ECONOMY",
  "business": "BUSINESS",
  "first": "FIRST"
};

function mapFareType(rawFareType) {
  const normalized = String(rawFareType || "").trim().toLowerCase();
  return FARE_TYPE_MAP[normalized] ?? "UNKNOWN";
}

export const tools = [
  {
    type: "function",
    name: "normalize_fare_type",
    description: "Map a raw fare label from an email into a normalized internal fare type enum",
    strict: true,
    inputSchema: {
      type: "object",
      properties: {
        raw_fare_type: { type: "string", description: "Raw fare label, e.g. Economy Flex" }
      },
      required: ["raw_fare_type"],
      additionalProperties: false
    }
  }
];

export const handlers = {
  async normalize_fare_type(args) {
    const raw = typeof args === "object" && args && "raw_fare_type" in args
      ? String(args.raw_fare_type)
      : "";

    return {
      raw_fare_type: raw,
      fare_type_normalized: mapFareType(raw)
    };
  }
};
`,
    },
    {
      filePath: path.resolve(cwd, ".github/workflows/promptmanager.yml"),
      content: `name: PromptManager CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  prompt-evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - run: npx promptmgr ci --suite customer-email-parser --provider openai --baseline ./baseline/run-report.json --fail-on-regression
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          GEMINI_API_KEY: \${{ secrets.GEMINI_API_KEY }}
`,
    },
  ];
}

export async function runInit(cwd: string, options: InitOptions): Promise<void> {
  const files = filesForCwd(cwd);
  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const outcome = await writeFileSafe(file, options.force ?? false);
    if (outcome === "created") {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  process.stdout.write(`Initialized PromptManager scaffold. created=${created} skipped=${skipped}\n`);
}
