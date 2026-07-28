import { packageBundle } from "../core/bundle.js";
import { createInvestigationRunner } from "../core/provider.js";
import type {
  BuildOptions,
  BuildResult,
  ProgressReporter,
  RebuildOptions,
  RunnerResolver
} from "../core/types.js";
import { NodeProjectWorkspace } from "../infrastructure/node-project-workspace.js";
import { BuildFeatureContext } from "./build-context.js";
import type { FeatureContextDependencies } from "./ports.js";
import { RebuildFeatureBundle } from "./rebuild-bundle.js";

export class FeatureContextService {
  private readonly buildUseCase: BuildFeatureContext;
  private readonly rebuildUseCase: RebuildFeatureBundle;

  constructor(
    resolveRunner: RunnerResolver = createInvestigationRunner,
    dependencies: Partial<Pick<FeatureContextDependencies, "workspace" | "packageBundle">> = {}
  ) {
    const resolved: FeatureContextDependencies = {
      resolveRunner,
      workspace: dependencies.workspace ?? new NodeProjectWorkspace(),
      packageBundle: dependencies.packageBundle ?? packageBundle
    };
    this.buildUseCase = new BuildFeatureContext(resolved);
    this.rebuildUseCase = new RebuildFeatureBundle(resolved);
  }

  build(
    options: BuildOptions,
    report: ProgressReporter = () => {},
    signal?: AbortSignal
  ): Promise<BuildResult> {
    return this.buildUseCase.execute(options, report, signal);
  }

  rebuild(
    options: RebuildOptions,
    report: ProgressReporter = () => {},
    signal?: AbortSignal
  ): Promise<BuildResult> {
    return this.rebuildUseCase.execute(options, report, signal);
  }
}
