export type Priority = "core" | "supporting" | "test";
export type AiProvider = "gemini" | "codex";

export interface InvestigationFile {
  path: string;
  role: string;
  reason: string;
  priority: Priority;
  group: string;
  recommended: boolean;
  summary?: string;
}

export interface Investigation {
  feature: string;
  overview?: string;
  flow: string[];
  files: InvestigationFile[];
  uncertainties: string[];
}

export interface CliInfo {
  provider: AiProvider;
  version: string;
  help: string;
}

export interface InvestigationRunRequest {
  projectRoot: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface InvestigationRunner {
  readonly provider: AiProvider;
  inspect(signal?: AbortSignal): Promise<CliInfo>;
  investigate(request: InvestigationRunRequest): Promise<Investigation>;
}

export type RunnerResolver = (provider: AiProvider) => InvestigationRunner;

export type ProgressStage =
  | "checking-cli"
  | "investigating"
  | "validating"
  | "collecting"
  | "packing"
  | "completed"
  | "error";

export interface ProgressEvent {
  stage: ProgressStage;
  message: string;
}

export interface BuildOptions {
  provider?: AiProvider;
  projectRoot: string;
  feature: string;
  outputDir?: string;
  name?: string;
  summary: boolean;
  concat: boolean;
  maxOutputFiles: number;
  maxTotalChars: number;
  maxFileChars?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  selections?: Record<string, boolean>;
}

export interface ValidationRecord extends InvestigationFile {
  normalizedPath?: string;
  valid: boolean;
  included: boolean;
  userSelected: boolean | null;
  exclusionReason?: string;
  size?: number;
}

export interface BundledSource {
  path: string;
  artifact: string;
  lineStart: number;
  lineEnd: number;
}

export interface OmittedSource {
  path: string;
  reason: string;
}

export interface BundleArtifact {
  name: string;
  path: string;
  chars: number;
}

export interface Manifest {
  schemaVersion: "1.1";
  feature: string;
  projectRoot: string;
  generatedAt: string;
  gitCommitId: string | null;
  options: {
    provider: AiProvider;
    summary: boolean;
    concat: boolean;
    maxOutputFiles: number;
    maxTotalChars: number;
    maxFileChars: number;
  };
  provider: {
    id: AiProvider;
    cliVersion: string;
  };
  investigation: Investigation;
  relatedFiles: ValidationRecord[];
  validation: {
    detected: number;
    valid: number;
    invalid: number;
  };
  selections: Record<string, boolean>;
  bundledSources: BundledSource[];
  omittedSources: OmittedSource[];
  bundleFiles: BundleArtifact[];
  totalChars: number;
  estimatedTokens: number;
  tokenEstimateMethod: string;
  warnings: string[];
  uncertainties: string[];
}

export interface BuildResult {
  manifestPath: string;
  outputDir: string;
  manifest: Manifest;
}

export interface RebuildOptions {
  manifestPath: string;
  selections: Record<string, boolean>;
  maxOutputFiles?: number;
  maxTotalChars?: number;
  force?: boolean;
}

export interface CollectedFile {
  record: ValidationRecord;
  content: string;
  lineCount: number;
}

export type ProgressReporter = (event: ProgressEvent) => void;
