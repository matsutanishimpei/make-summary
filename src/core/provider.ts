import { CodexCliRunner } from "./codex.js";
import { GeminiApiRunner } from "./gemini-api.js";
import { GeminiCliRunner } from "./gemini.js";
import {
  getProviderDescriptor,
  isProviderId,
  PROVIDER_CATALOG,
  type ProviderDescriptor
} from "../contracts/providers.js";
import type { AiProvider, InvestigationRunner, RunnerConfig } from "./types.js";

export type InvestigationRunnerFactory = (config: RunnerConfig) => InvestigationRunner;

export class InvestigationProviderRegistry {
  private readonly factories = new Map<AiProvider, InvestigationRunnerFactory>();

  register(descriptor: ProviderDescriptor, factory: InvestigationRunnerFactory): this {
    if (this.factories.has(descriptor.id)) {
      throw new Error(`AI provider is already registered: ${descriptor.id}`);
    }
    this.factories.set(descriptor.id, factory);
    return this;
  }

  create(provider: AiProvider, config: RunnerConfig = {}): InvestigationRunner {
    const factory = this.factories.get(provider);
    if (!factory) throw new Error(`AI provider is not registered: ${provider}`);
    return factory(config);
  }

  descriptors(): ProviderDescriptor[] {
    return PROVIDER_CATALOG.filter((descriptor) => this.factories.has(descriptor.id));
  }
}

export const providerLabels = Object.fromEntries(
  PROVIDER_CATALOG.map((provider) => [provider.id, provider.label])
) as Record<AiProvider, string>;

export function createDefaultProviderRegistry(): InvestigationProviderRegistry {
  return new InvestigationProviderRegistry()
    .register(getProviderDescriptor("gemini"), () => new GeminiCliRunner())
    .register(
      getProviderDescriptor("gemini-api"),
      (config) =>
        new GeminiApiRunner({
          apiKey: config.geminiApiKey,
          model: config.geminiApiModel
        })
    )
    .register(getProviderDescriptor("codex"), () => new CodexCliRunner());
}

const defaultRegistry = createDefaultProviderRegistry();

export function createInvestigationRunner(
  provider: AiProvider,
  config: RunnerConfig = {}
): InvestigationRunner {
  return defaultRegistry.create(provider, config);
}

export function isAiProvider(value: unknown): value is AiProvider {
  return isProviderId(value);
}
