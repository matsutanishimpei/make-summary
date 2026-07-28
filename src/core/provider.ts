import { CodexCliRunner } from "./codex.js";
import { GeminiApiRunner } from "./gemini-api.js";
import { GeminiCliRunner } from "./gemini.js";
import type { AiProvider, InvestigationRunner, RunnerConfig } from "./types.js";

export const providerLabels: Record<AiProvider, string> = {
  gemini: "Gemini CLI",
  "gemini-api": "Gemini API",
  codex: "Codex CLI"
};

export function createInvestigationRunner(
  provider: AiProvider,
  config: RunnerConfig = {}
): InvestigationRunner {
  if (provider === "codex") return new CodexCliRunner();
  if (provider === "gemini-api") {
    return new GeminiApiRunner({
      apiKey: config.geminiApiKey,
      model: config.geminiApiModel
    });
  }
  return new GeminiCliRunner();
}

export function isAiProvider(value: unknown): value is AiProvider {
  return value === "gemini" || value === "gemini-api" || value === "codex";
}
