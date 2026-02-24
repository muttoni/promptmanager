export type ProviderId = "openai" | "anthropic" | "google";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  strict?: boolean;
}

export interface ToolModuleShape {
  tools: ToolDefinition[];
  handlers: Record<string, (args: JsonValue, context: ToolExecutionContext) => Promise<JsonValue> | JsonValue>;
}

export interface ToolExecutionContext {
  suiteId: string;
  hashedCaseId: string;
  rawCaseId: string;
  provider: ProviderId;
  model: string;
}

export interface SuiteConfig {
  id: string;
  promptId: string;
  datasetPath: string;
  schemaPath: string;
  assertionsPath: string;
  toolsModule: string;
  modelByProvider: Record<ProviderId, string>;
}

export interface ToolRunnerConfig {
  mode: "subprocess";
  command: string;
  envAllowlist: string[];
  timeoutMs: number;
  maxToolCallsPerCase: number;
}

export interface PrivacyConfig {
  allowRawProductionFixtures: true;
  redactInReports: boolean;
  encryptionAtRest: boolean;
}

export interface ReportingConfig {
  includeToolTrace?: boolean;
  outDir?: string;
}

export interface ProviderConfig {
  apiKeyEnv?: string;
  baseUrl?: string;
  toolChoice?: JsonValue;
  parallelToolCalls?: boolean;
}

export interface PromptManagerConfig {
  providers: Record<ProviderId, ProviderConfig>;
  suites: SuiteConfig[];
  toolRunner: ToolRunnerConfig;
  privacy: PrivacyConfig;
  reporting: ReportingConfig;
}

export interface PromptMeta {
  currentVersion?: string;
  versions?: string[];
}

export interface PromptRecord {
  promptId: string;
  version: string;
  body: string;
}

export interface EvalCase {
  caseId: string;
  input: JsonValue;
  expected: JsonValue;
  tags?: string[];
}

export type AssertionOperator =
  | "equals"
  | "oneOf"
  | "contains"
  | "regex"
  | "numericRange"
  | "exists"
  | "absent";

export interface NumericRangeMatcher {
  min?: number;
  max?: number;
}

export interface FieldMatcher {
  op: AssertionOperator;
  value?: JsonValue | NumericRangeMatcher;
  expectedPath?: string;
}

export interface AssertionSpec {
  requiredKeys: string[];
  allowAdditionalKeys?: boolean;
  variableFields?: string[];
  fieldMatchers?: Record<string, FieldMatcher[]>;
}

export interface AssertionCheckResult {
  field: string;
  op: AssertionOperator;
  passed: boolean;
  actual?: JsonValue;
  expected?: JsonValue;
  message: string;
}

export interface AssertionResult {
  passed: boolean;
  checks: AssertionCheckResult[];
  missingKeys: string[];
  unexpectedKeys: string[];
}

export interface ToolCallTrace {
  id: string;
  name: string;
  args: JsonValue;
  result?: JsonValue;
  latencyMs: number;
  status: "ok" | "error";
  errorCode?: string;
  errorMessage?: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  args: JsonValue;
}

export interface ProviderToolResult {
  callId: string;
  name: string;
  result: JsonValue;
}

export interface ProviderRequest {
  model: string;
  prompt: string;
  input: JsonValue;
  tools: ToolDefinition[];
  maxToolCalls: number;
  invokeTool: (call: ProviderToolCall) => Promise<ProviderToolResult>;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  finalOutput: JsonValue;
  finalText: string;
  toolTrace: ToolCallTrace[];
  usage?: JsonObject;
  rawResponse?: JsonValue;
}

export interface ProviderAdapter {
  id: ProviderId;
  invokeWithTools(req: ProviderRequest): Promise<ProviderResponse>;
}

export interface RunConfig {
  suiteId: string;
  provider: ProviderId;
  model?: string;
  configPath?: string;
  outPath?: string;
  cwd?: string;
  concurrency?: number;
}

export interface RunCaseResult {
  hashedCaseId: string;
  rawCaseId: string;
  status: "pass" | "fail" | "error";
  schemaValid: boolean;
  assertionsPassed: boolean;
  assertionResult: AssertionResult;
  errors: string[];
  output: JsonValue;
  redactedOutput: JsonValue;
  expected: JsonValue;
  latencyMs: number;
  provider: ProviderId;
  model: string;
  usage?: JsonObject;
  toolTrace: ToolCallTrace[];
  tags: string[];
}

export interface RunSummary {
  total: number;
  pass: number;
  fail: number;
  error: number;
  durationMs: number;
}

export interface RunReport {
  version: "1";
  suiteId: string;
  provider: ProviderId;
  model: string;
  startedAt: string;
  endedAt: string;
  summary: RunSummary;
  warnings: string[];
  prompt: {
    promptId: string;
    version: string;
  };
  cases: RunCaseResult[];
}

export interface CaseDiff {
  hashedCaseId: string;
  baselineStatus: RunCaseResult["status"];
  candidateStatus: RunCaseResult["status"];
}

export interface DiffReport {
  baselineSuiteId: string;
  candidateSuiteId: string;
  comparedAt: string;
  totalCompared: number;
  regressions: CaseDiff[];
  improvements: CaseDiff[];
  unchanged: number;
}

export interface Suggestion {
  title: string;
  rationale: string;
  suggestedPatch: string;
  impactedFields: string[];
}

export interface SuggestionInput {
  report: RunReport;
  maxSuggestions?: number;
  withAi?: boolean;
  aiModel?: string;
}

export interface SuggestionReport {
  generatedAt: string;
  suiteId: string;
  provider: ProviderId;
  model: string;
  suggestions: Suggestion[];
}

export interface ToolWorkerRequest {
  toolsModulePath: string;
  toolName: string;
  args: JsonValue;
  context: ToolExecutionContext;
}

export interface ToolWorkerResponse {
  ok: boolean;
  result?: JsonValue;
  error?: {
    code: string;
    message: string;
  };
}
