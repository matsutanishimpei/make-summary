export const FEATURE_CONTEXT_DEFAULTS = {
  provider: "gemini",
  geminiApiModel: "gemini-3.5-flash",
  maxOutputFiles: 5,
  maxTotalChars: 120_000
} as const;

export const FEATURE_CONTEXT_LIMITS = {
  minOutputFiles: 1,
  maxOutputFiles: 5,
  minTotalChars: 1_000,
  maxTotalChars: 2_000_000
} as const;
