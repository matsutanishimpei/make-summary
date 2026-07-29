/**
 * @feature-context
 * @feature mobile gateway contracts, automatic source inclusion, remote jobs
 * @role スマホへ公開するproject・job・artifact・容量再構築DTOを定義する
 * @entry MobileBuildRequest, RemoteJob, RebuildRequest
 * @flow gateway domain state -> source-selection-free mobile DTO
 * @related job-service.ts, ../mobile/MobileApp.tsx
 * @caution project path、API key、file単位のselectionsをスマホ公開契約へ含めない
 */

import type {
  AiProvider,
  ProgressEvent,
  ValidationRecord
} from "../core/types.js";

export interface RegisteredProject {
  id: string;
  label: string;
  root: string;
  createdAt: string;
}

export interface MobileProject {
  id: string;
  label: string;
}

export interface PairedSession {
  id: string;
  deviceName: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface GatewaySettings {
  schemaVersion: 1;
  enabled: boolean;
  port: number;
  publicUrl: string;
  projects: RegisteredProject[];
  sessions: PairedSession[];
}

export interface GatewayStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  localUrl: string;
  publicUrl: string;
  projects: RegisteredProject[];
  pairedDevices: Array<Omit<PairedSession, "tokenHash">>;
  hasGeminiApiKey: boolean;
  autoStart: boolean;
  tailscale: {
    installed: boolean;
    connected: boolean;
    dnsName?: string;
    message?: string;
  };
}

export interface PairingInfo {
  url: string;
  expiresAt: string;
  qrDataUrl: string;
}

export interface MobileBuildRequest {
  projectId: string;
  feature: string;
  provider: AiProvider;
  summary: boolean;
  concat: boolean;
  maxOutputFiles: number;
  maxTotalChars: number;
  geminiApiModel?: string;
}

export type RemoteJobState = "queued" | "running" | "completed" | "error" | "cancelled";

export interface RemoteArtifact {
  name: string;
  chars: number;
  downloadUrl: string;
}

export interface RemoteJobResult {
  feature: string;
  provider: AiProvider;
  detectedFiles: number;
  bundledSourceFiles: number;
  totalChars: number;
  estimatedTokens: number;
  warnings: string[];
  uncertainties: string[];
  artifacts: RemoteArtifact[];
  relatedFiles: Array<
    Pick<
      ValidationRecord,
      | "path"
      | "normalizedPath"
      | "role"
      | "reason"
      | "priority"
      | "group"
      | "valid"
      | "included"
      | "exclusionReason"
    >
  >;
  zipUrl: string;
}

export interface RemoteJob {
  id: string;
  projectId: string;
  projectLabel: string;
  feature: string;
  state: RemoteJobState;
  createdAt: string;
  updatedAt: string;
  progress?: ProgressEvent;
  error?: {
    code?: string;
    message: string;
  };
  result?: RemoteJobResult;
}

export interface RebuildRequest {
  maxOutputFiles?: number;
  maxTotalChars?: number;
}
