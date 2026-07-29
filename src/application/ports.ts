import type { PackageInput } from "../core/bundle.js";
import type {
  CollectedFile,
  InvestigationFile,
  Manifest,
  RunnerResolver,
  ValidationRecord
} from "../core/types.js";

export interface ValidationOutcome {
  records: ValidationRecord[];
  warnings: string[];
}

export interface CollectionOutcome {
  files: CollectedFile[];
  warnings: string[];
}

export interface ProjectWorkspacePort {
  resolveProjectRoot(input: string): Promise<string>;
  resolveOutputDir(projectRoot: string, outputBase: string | undefined, name: string): string;
  assertOutputInside(projectRoot: string, outputDir: string): void;
  assertOutputAvailable(outputDir: string): Promise<void>;
  validateRelatedFiles(
    projectRoot: string,
    files: InvestigationFile[]
  ): Promise<ValidationOutcome>;
  collectSelectedFiles(
    projectRoot: string,
    records: ValidationRecord[]
  ): Promise<CollectionOutcome>;
  getGitCommitId(projectRoot: string): Promise<string | null>;
  readManifest(manifestPath: string): Promise<Manifest>;
}

export interface FeatureContextDependencies {
  resolveRunner: RunnerResolver;
  workspace: ProjectWorkspacePort;
  packageBundle(input: PackageInput): Promise<Manifest>;
}
