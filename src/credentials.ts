export interface GeminiCredentialStatus {
  hasKey: boolean;
  source: "encrypted" | "environment" | null;
}
