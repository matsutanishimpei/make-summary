import type { BuildOptions } from "../core/types.js";

export interface GeminiApiKeyProvider {
  getGeminiApiKey(): Promise<string | undefined>;
}

export async function resolveDesktopBuildOptions(
  options: BuildOptions,
  credentials: GeminiApiKeyProvider
): Promise<BuildOptions> {
  if (options.provider !== "gemini-api") return options;
  return {
    ...options,
    geminiApiKey: await credentials.getGeminiApiKey()
  };
}
