import type {
  CollectedFile,
  Investigation,
  Manifest,
  ValidationRecord
} from "../types.js";

export interface PackageInput {
  projectRoot: string;
  outputDir: string;
  investigation: Investigation;
  records: ValidationRecord[];
  collected: CollectedFile[];
  summary: boolean;
  concat: boolean;
  maxOutputFiles: number;
  maxTotalChars: number;
  maxFileChars: number;
  geminiApiModel?: string;
  provider: Manifest["provider"]["id"];
  cliVersion: string;
  gitCommitId: string | null;
  warnings: string[];
  dryRun: boolean;
  force: boolean;
}

export interface ArtifactContent {
  name: string;
  content: string;
}

export const priorityRank = { core: 0, supporting: 1, test: 2 } as const;
