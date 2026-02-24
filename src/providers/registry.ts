import { ProviderAdapter, ProviderConfig, ProviderId } from "../types.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createGoogleAdapter } from "./google.js";
import { createOpenAiAdapter } from "./openai.js";

const registry = new Map<ProviderId, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getProvider(providerId: ProviderId): ProviderAdapter {
  const adapter = registry.get(providerId);
  if (!adapter) {
    throw new Error(`No provider adapter registered for '${providerId}'.`);
  }
  return adapter;
}

export function clearProvidersForTests(): void {
  registry.clear();
  builtinsRegistered = false;
}

let builtinsRegistered = false;

export function registerBuiltinProviders(config: Record<ProviderId, ProviderConfig>): void {
  if (builtinsRegistered) {
    return;
  }
  registerProvider(createOpenAiAdapter(config.openai));
  registerProvider(createAnthropicAdapter(config.anthropic));
  registerProvider(createGoogleAdapter(config.google));
  builtinsRegistered = true;
}
