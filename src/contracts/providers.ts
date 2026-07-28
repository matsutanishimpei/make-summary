export type ProviderId = "gemini" | "gemini-api" | "codex";

export interface ProviderCapabilities {
  kind: "cli" | "api";
  customModel: boolean;
  credentialRequired: boolean;
  directWorkspaceAccess: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapabilities;
}

export const PROVIDER_CATALOG: readonly ProviderDescriptor[] = [
  {
    id: "gemini",
    label: "Gemini CLI",
    capabilities: {
      kind: "cli",
      customModel: false,
      credentialRequired: false,
      directWorkspaceAccess: true
    }
  },
  {
    id: "gemini-api",
    label: "Gemini API",
    capabilities: {
      kind: "api",
      customModel: true,
      credentialRequired: true,
      directWorkspaceAccess: false
    }
  },
  {
    id: "codex",
    label: "Codex CLI",
    capabilities: {
      kind: "cli",
      customModel: false,
      credentialRequired: false,
      directWorkspaceAccess: true
    }
  }
] as const;

export function isProviderId(value: unknown): value is ProviderId {
  return PROVIDER_CATALOG.some((provider) => provider.id === value);
}

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDER_CATALOG.find((provider) => provider.id === id)!;
}
