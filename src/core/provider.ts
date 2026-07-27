import { CodexCliRunner } from "./codex.js";
import { GeminiCliRunner } from "./gemini.js";
import type { AiProvider, InvestigationRunner } from "./types.js";

export const providerLabels: Record<AiProvider, string> = {
  gemini: "Gemini",
  codex: "Codex"
};

export function createInvestigationRunner(provider: AiProvider): InvestigationRunner {
  return provider === "codex" ? new CodexCliRunner() : new GeminiCliRunner();
}

export function isAiProvider(value: unknown): value is AiProvider {
  return value === "gemini" || value === "codex";
}
