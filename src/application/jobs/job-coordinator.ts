export type CoordinatedJobState = "running" | "completed" | "error" | "cancelled";

export interface CoordinatedJobError {
  code?: string;
  message: string;
  details?: string;
}

export interface CoordinatedJob<Metadata, Result, Progress> {
  id: string;
  metadata: Metadata;
  state: CoordinatedJobState;
  createdAt: string;
  updatedAt: string;
  progress?: Progress;
  result?: Result;
  error?: CoordinatedJobError;
}

export interface JobOperationContext<Progress> {
  signal: AbortSignal;
  report(progress: Progress): void;
}

export interface JobHandle<Metadata, Result, Progress> {
  readonly job: CoordinatedJob<Metadata, Result, Progress>;
  readonly completion: Promise<Result>;
}

export interface JobCoordinatorOptions {
  maxJobs?: number;
  now?: () => Date;
}

interface InternalJob<Metadata, Result, Progress> {
  view: CoordinatedJob<Metadata, Result, Progress>;
  controller: AbortController;
  listeners: Set<(job: CoordinatedJob<Metadata, Result, Progress>) => void>;
  completion: Promise<Result>;
}

export class JobCoordinator<Metadata, Result, Progress> {
  private readonly jobs = new Map<string, InternalJob<Metadata, Result, Progress>>();
  private readonly maxJobs: number;
  private readonly now: () => Date;

  constructor(options: JobCoordinatorOptions = {}) {
    this.maxJobs = options.maxJobs ?? 20;
    this.now = options.now ?? (() => new Date());
  }

  start(
    id: string,
    metadata: Metadata,
    operation: (context: JobOperationContext<Progress>) => Promise<Result>
  ): JobHandle<Metadata, Result, Progress> {
    if (this.jobs.has(id)) throw new Error(`Job is already registered: ${id}`);
    const now = this.now().toISOString();
    const controller = new AbortController();
    const view: CoordinatedJob<Metadata, Result, Progress> = {
      id,
      metadata,
      state: "running",
      createdAt: now,
      updatedAt: now
    };
    const internal: InternalJob<Metadata, Result, Progress> = {
      view,
      controller,
      listeners: new Set<(job: CoordinatedJob<Metadata, Result, Progress>) => void>(),
      completion: undefined as unknown as Promise<Result>
    };
    this.jobs.set(id, internal);
    const report = (progress: Progress) => {
      view.progress = progress;
      view.updatedAt = this.now().toISOString();
      this.publish(internal);
    };
    internal.completion = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw Object.assign(new Error("処理をキャンセルしました。"), { code: "CANCELLED" });
        }
        return operation({ signal: controller.signal, report });
      })
      .then((result) => {
        view.result = result;
        view.state = "completed";
        view.updatedAt = this.now().toISOString();
        this.publish(internal);
        this.prune();
        return result;
      })
      .catch((error: unknown) => {
        const normalized = normalizeJobError(error);
        view.state =
          controller.signal.aborted || normalized.code === "CANCELLED" ? "cancelled" : "error";
        view.error = normalized;
        view.updatedAt = this.now().toISOString();
        this.publish(internal);
        this.prune();
        throw error;
      });
    this.publish(internal);
    return { job: view, completion: internal.completion };
  }

  get(id: string): CoordinatedJob<Metadata, Result, Progress> | undefined {
    return this.jobs.get(id)?.view;
  }

  require(id: string): CoordinatedJob<Metadata, Result, Progress> {
    const job = this.get(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return job;
  }

  list(): Array<CoordinatedJob<Metadata, Result, Progress>> {
    return [...this.jobs.values()].map((job) => job.view);
  }

  hasActive(): boolean {
    return [...this.jobs.values()].some((job) => job.view.state === "running");
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.view.state !== "running") return false;
    job.controller.abort();
    return true;
  }

  subscribe(
    id: string,
    listener: (job: CoordinatedJob<Metadata, Result, Progress>) => void
  ): () => void {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    job.listeners.add(listener);
    listener(job.view);
    return () => job.listeners.delete(listener);
  }

  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.view.state === "running") return false;
    job.listeners.clear();
    return this.jobs.delete(id);
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      if (job.view.state === "running") job.controller.abort();
      job.listeners.clear();
    }
  }

  private publish(job: InternalJob<Metadata, Result, Progress>): void {
    for (const listener of job.listeners) listener(job.view);
  }

  private prune(): void {
    const completed = [...this.jobs.values()].filter((job) => job.view.state !== "running");
    while (this.jobs.size > this.maxJobs && completed.length) {
      const oldest = completed.shift()!;
      oldest.listeners.clear();
      this.jobs.delete(oldest.view.id);
    }
  }
}

function normalizeJobError(error: unknown): CoordinatedJobError {
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  return {
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    message:
      typeof value.message === "string"
        ? value.message
        : "処理中に予期しないエラーが発生しました。",
    ...(typeof value.details === "string" ? { details: value.details } : {})
  };
}
