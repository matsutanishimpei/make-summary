import { randomUUID } from "node:crypto";
import {
  JobCoordinator,
  type CoordinatedJob
} from "../application/jobs/job-coordinator.js";
import {
  FeatureContextService,
  isAiProvider,
  type BuildOptions,
  type BuildResult,
  type ProgressEvent
} from "../core/index.js";
import { HttpError } from "./http.js";
import type { GatewaySettingsStore } from "./settings.js";
import type {
  MobileBuildRequest,
  RebuildRequest,
  RemoteJob,
  RemoteJobResult
} from "./types.js";

const MAX_JOBS = 20;

export interface GatewayCredentialProvider {
  getGeminiApiKey(): Promise<string | undefined>;
}

export interface GatewayJobServiceOptions {
  settings: GatewaySettingsStore;
  credentials?: GatewayCredentialProvider;
  serviceFactory?: () => FeatureContextService;
  now?: () => Date;
}

export interface MobileJobMetadata {
  projectId: string;
  projectLabel: string;
  feature: string;
}

export type GatewayJob = CoordinatedJob<MobileJobMetadata, BuildResult, ProgressEvent>;

export class GatewayJobService {
  private readonly coordinator: JobCoordinator<MobileJobMetadata, BuildResult, ProgressEvent>;

  constructor(private readonly options: GatewayJobServiceOptions) {
    this.coordinator = new JobCoordinator({
      maxJobs: MAX_JOBS,
      now: options.now
    });
  }

  list(): RemoteJob[] {
    return this.coordinator.list().map(toRemoteJob).reverse();
  }

  get(id: string): RemoteJob {
    return toRemoteJob(this.requireInternal(id));
  }

  getCompleted(id: string): GatewayJob & { result: BuildResult } {
    const job = this.requireInternal(id);
    if (job.state !== "completed" || !job.result) {
      throw new HttpError(409, "成果物はまだ生成されていません。");
    }
    return job as GatewayJob & { result: BuildResult };
  }

  async createBuild(body: MobileBuildRequest): Promise<RemoteJob> {
    validateBuildRequest(body);
    this.assertIdle();
    const settings = await this.options.settings.load();
    const project = settings.projects.find((item) => item.id === body.projectId);
    if (!project) throw new HttpError(400, "登録済みプロジェクトを選択してください。");
    const key =
      body.provider === "gemini-api"
        ? await this.options.credentials?.getGeminiApiKey()
        : undefined;
    const id = randomUUID();
    const options: BuildOptions = {
      projectRoot: project.root,
      feature: body.feature.trim(),
      provider: body.provider,
      geminiApiKey: key,
      geminiApiModel: body.geminiApiModel,
      summary: body.summary,
      concat: body.concat,
      maxOutputFiles: body.maxOutputFiles,
      maxTotalChars: body.maxTotalChars,
      name: `${body.feature.trim()}-${id.slice(0, 8)}`,
      force: false
    };
    const handle = this.coordinator.start(
      id,
      {
        projectId: project.id,
        projectLabel: project.label,
        feature: body.feature.trim()
      },
      ({ signal, report }) => this.createService().build(options, report, signal)
    );
    void handle.completion.catch(() => {});
    return toRemoteJob(handle.job);
  }

  async createRebuild(sourceId: string, body: RebuildRequest): Promise<RemoteJob> {
    const source = this.getCompleted(sourceId);
    validateRebuildRequest(body);
    this.assertIdle();
    const id = randomUUID();
    const handle = this.coordinator.start(
      id,
      source.metadata,
      ({ signal, report }) =>
        this.createService().rebuild(
          {
            manifestPath: source.result.manifestPath,
            selections: body.selections,
            maxOutputFiles: body.maxOutputFiles,
            maxTotalChars: body.maxTotalChars,
            force: true
          },
          report,
          signal
        )
    );
    void handle.completion.catch(() => {});
    return toRemoteJob(handle.job);
  }

  cancel(id: string): boolean {
    this.requireInternal(id);
    return this.coordinator.cancel(id);
  }

  subscribe(id: string, listener: (job: RemoteJob) => void): () => void {
    this.requireInternal(id);
    return this.coordinator.subscribe(id, (job) => listener(toRemoteJob(job)));
  }

  stopAll(): void {
    this.coordinator.stopAll();
  }

  private createService(): FeatureContextService {
    return this.options.serviceFactory?.() ?? new FeatureContextService();
  }

  private assertIdle(): void {
    if (this.coordinator.hasActive()) {
      throw new HttpError(409, "別のスマホ調査が実行中です。完了後に再実行してください。");
    }
  }

  private requireInternal(id: string): GatewayJob {
    const job = this.coordinator.get(id);
    if (!job) throw new HttpError(404, "ジョブが見つかりません。");
    return job;
  }
}

export function validateBuildRequest(body: MobileBuildRequest): void {
  if (
    !body ||
    typeof body.projectId !== "string" ||
    typeof body.feature !== "string" ||
    !body.feature.trim() ||
    body.feature.length > 2_000 ||
    !isAiProvider(body.provider) ||
    typeof body.summary !== "boolean" ||
    typeof body.concat !== "boolean" ||
    !Number.isInteger(body.maxOutputFiles) ||
    body.maxOutputFiles < 1 ||
    body.maxOutputFiles > 5 ||
    !Number.isInteger(body.maxTotalChars) ||
    body.maxTotalChars < 1_000 ||
    body.maxTotalChars > 2_000_000 ||
    (body.geminiApiModel !== undefined &&
      (typeof body.geminiApiModel !== "string" ||
        !/^[a-zA-Z0-9._-]+$/.test(body.geminiApiModel)))
  ) {
    throw new HttpError(400, "調査内容または上限値が不正です。");
  }
}

export function validateRebuildRequest(body: RebuildRequest): void {
  if (
    !body?.selections ||
    typeof body.selections !== "object" ||
    Object.keys(body.selections).length > 10_000 ||
    Object.values(body.selections).some((value) => typeof value !== "boolean") ||
    (body.maxOutputFiles !== undefined &&
      (!Number.isInteger(body.maxOutputFiles) ||
        body.maxOutputFiles < 1 ||
        body.maxOutputFiles > 5)) ||
    (body.maxTotalChars !== undefined &&
      (!Number.isInteger(body.maxTotalChars) ||
        body.maxTotalChars < 1_000 ||
        body.maxTotalChars > 2_000_000))
  ) {
    throw new HttpError(400, "関連ソースの選択が不正です。");
  }
}

export function toRemoteJob(job: GatewayJob): RemoteJob {
  return {
    id: job.id,
    projectId: job.metadata.projectId,
    projectLabel: job.metadata.projectLabel,
    feature: job.metadata.feature,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.error
      ? {
          error: {
            ...(job.error.code ? { code: job.error.code } : {}),
            message: job.error.message
          }
        }
      : {}),
    ...(job.result ? { result: toRemoteResult(job.id, job.result) } : {})
  };
}

function toRemoteResult(jobId: string, result: BuildResult): RemoteJobResult {
  return {
    feature: result.manifest.feature,
    provider: result.manifest.provider.id,
    detectedFiles: result.manifest.validation.detected,
    bundledSourceFiles: new Set(result.manifest.bundledSources.map((item) => item.path)).size,
    totalChars: result.manifest.totalChars,
    estimatedTokens: result.manifest.estimatedTokens,
    warnings: result.manifest.warnings,
    uncertainties: result.manifest.uncertainties,
    artifacts: result.manifest.bundleFiles.map((artifact) => ({
      name: artifact.name,
      chars: artifact.chars,
      downloadUrl: `/api/v1/jobs/${jobId}/artifacts/${encodeURIComponent(artifact.name)}?download=1`
    })),
    relatedFiles: result.manifest.relatedFiles.map((record) => ({
      path: record.path,
      normalizedPath: record.normalizedPath,
      role: record.role,
      reason: record.reason,
      priority: record.priority,
      group: record.group,
      valid: record.valid,
      included: record.included,
      exclusionReason: record.exclusionReason
    })),
    selections: result.manifest.selections,
    zipUrl: `/api/v1/jobs/${jobId}/bundle.zip`
  };
}
