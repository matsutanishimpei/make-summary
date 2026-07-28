import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FeatureContextError, asFeatureContextError } from "./errors.js";
import { createInvestigationRunner, isAiProvider, providerLabels } from "./provider.js";
import { createInvestigationPrompt } from "./prompt.js";
import { collectSelectedFiles, packageBundle } from "./bundle.js";
import { validateRelatedFiles } from "./validate.js";
import type {
  BuildOptions,
  BuildResult,
  Manifest,
  ProgressReporter,
  RebuildOptions,
  RunnerResolver
} from "./types.js";

const execFileAsync = promisify(execFile);

export class FeatureContextService {
  constructor(private readonly resolveRunner: RunnerResolver = createInvestigationRunner) {}

  async build(
    options: BuildOptions,
    report: ProgressReporter = () => {},
    signal?: AbortSignal
  ): Promise<BuildResult> {
    try {
      validateOptions(options);
      const projectRoot = await resolveProjectRoot(options.projectRoot);
      const outputDir = resolveOutputDir(projectRoot, options.outputDir, options.name ?? options.feature);
      const provider = options.provider ?? "gemini";
      const providerName = providerLabels[provider];
      const runner = this.resolveRunner(provider, {
        geminiApiKey: options.geminiApiKey,
        geminiApiModel: options.geminiApiModel
      });
      throwIfAborted(signal);
      if (!options.dryRun && !options.force) await assertOutputAvailable(outputDir);

      report({ stage: "checking-cli", message: `${providerName}を確認中` });
      const info = await runner.inspect(signal);
      report({ stage: "investigating", message: "コードベースを調査中" });
      const investigation = await runner.investigate({
        projectRoot,
        prompt: createInvestigationPrompt(options.feature, options.summary),
        timeoutMs: options.timeoutMs ?? 180_000,
        signal
      });
      throwIfAborted(signal);

      report({ stage: "validating", message: "関連ファイルを検証中" });
      const validation = await validateRelatedFiles(projectRoot, investigation.files, options.selections);
      if (!validation.records.some((record) => record.valid)) {
        throw new FeatureContextError("NO_VALID_FILES", undefined, validation.warnings.join("\n"));
      }
      report({ stage: "collecting", message: "コードを収集中" });
      const collection = await collectSelectedFiles(projectRoot, validation.records);
      throwIfAborted(signal);

      report({ stage: "packing", message: "添付用ファイルへ整理中" });
      const gitCommitId = await getGitCommitId(projectRoot);
      const manifest = await packageBundle({
        projectRoot,
        outputDir,
        investigation,
        records: validation.records,
        collected: collection.files,
        summary: options.summary,
        concat: options.concat,
        maxOutputFiles: options.maxOutputFiles,
        maxTotalChars: options.maxTotalChars,
        maxFileChars: options.maxFileChars ?? Math.min(60_000, options.maxTotalChars),
        geminiApiModel: provider === "gemini-api" ? info.version : undefined,
        provider,
        cliVersion: info.version,
        gitCommitId,
        warnings: [...validation.warnings, ...collection.warnings],
        dryRun: options.dryRun ?? false,
        force: options.force ?? false
      });
      report({ stage: "completed", message: "完了" });
      return {
        outputDir,
        manifestPath: path.join(outputDir, "manifest.json"),
        manifest
      };
    } catch (error) {
      const normalized = asFeatureContextError(error);
      report({ stage: "error", message: normalized.message });
      throw normalized;
    }
  }

  async rebuild(
    options: RebuildOptions,
    report: ProgressReporter = () => {},
    signal?: AbortSignal
  ): Promise<BuildResult> {
    try {
      report({ stage: "validating", message: "関連ファイルを再検証中" });
      const manifest = await readManifest(options.manifestPath);
      const projectRoot = await resolveProjectRoot(manifest.projectRoot);
      const outputDir = path.dirname(path.resolve(options.manifestPath));
      assertInside(projectRoot, outputDir);
      const validation = await validateRelatedFiles(projectRoot, manifest.investigation.files, options.selections);
      if (!validation.records.some((record) => record.valid)) throw new FeatureContextError("NO_VALID_FILES");
      report({ stage: "collecting", message: "選択したコードを収集中" });
      const collection = await collectSelectedFiles(projectRoot, validation.records);
      throwIfAborted(signal);
      report({ stage: "packing", message: "AIを再実行せずbundleを再構築中" });
      const rebuilt = await packageBundle({
        projectRoot,
        outputDir,
        investigation: manifest.investigation,
        records: validation.records,
        collected: collection.files,
        summary: manifest.options.summary,
        concat: manifest.options.concat,
        maxOutputFiles: options.maxOutputFiles ?? manifest.options.maxOutputFiles,
        maxTotalChars: options.maxTotalChars ?? manifest.options.maxTotalChars,
        maxFileChars: manifest.options.maxFileChars,
        geminiApiModel: manifest.options.geminiApiModel,
        provider: manifest.provider.id,
        cliVersion: manifest.provider.cliVersion,
        gitCommitId: await getGitCommitId(projectRoot),
        warnings: [...validation.warnings, ...collection.warnings],
        dryRun: false,
        force: options.force ?? false
      });
      report({ stage: "completed", message: "再構築が完了しました" });
      return { outputDir, manifestPath: path.join(outputDir, "manifest.json"), manifest: rebuilt };
    } catch (error) {
      const normalized = asFeatureContextError(error);
      report({ stage: "error", message: normalized.message });
      throw normalized;
    }
  }
}

async function resolveProjectRoot(input: string): Promise<string> {
  try {
    const root = await fs.realpath(path.resolve(input));
    if (!(await fs.stat(root)).isDirectory()) throw new Error("not a directory");
    return root;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new FeatureContextError(
      code === "EACCES" || code === "EPERM" ? "READ_DENIED" : "ROOT_NOT_FOUND",
      undefined,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function resolveOutputDir(projectRoot: string, outputBase: string | undefined, name: string): string {
  const base = outputBase ? path.resolve(projectRoot, outputBase) : path.join(projectRoot, ".feature-context");
  assertInside(projectRoot, base);
  const output = path.resolve(base, safeName(name));
  assertInside(projectRoot, output);
  return output;
}

function safeName(input: string): string {
  const name = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^\.+|-+$/g, "")
    .slice(0, 64);
  return name || "feature";
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new FeatureContextError("INVALID_OUTPUT");
  }
}

function validateOptions(options: BuildOptions): void {
  if (
    !options.feature.trim() ||
    (options.provider !== undefined && !isAiProvider(options.provider)) ||
    !Number.isInteger(options.maxOutputFiles) ||
    options.maxOutputFiles < 1 ||
    options.maxOutputFiles > 5 ||
    !Number.isInteger(options.maxTotalChars) ||
    options.maxTotalChars < 1000
  ) {
    throw new FeatureContextError("INVALID_OPTIONS");
  }
}

async function getGitCommitId(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      windowsHide: true,
      timeout: 5000
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readManifest(manifestPath: string): Promise<Manifest> {
  try {
    const value = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8")) as Record<string, unknown>;
    if (!value.provider && typeof value.geminiCliVersion === "string") {
      value.provider = { id: "gemini", cliVersion: value.geminiCliVersion };
      value.schemaVersion = "1.1";
      const options = value.options as Record<string, unknown> | undefined;
      if (options) options.provider = "gemini";
    }
    return value as unknown as Manifest;
  } catch (error) {
    throw new FeatureContextError("INVALID_OUTPUT", "manifest.jsonを読み取れません。", String(error));
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new FeatureContextError("CANCELLED");
}

async function assertOutputAvailable(outputDir: string): Promise<void> {
  try {
    const stat = await fs.stat(outputDir);
    if (!stat.isDirectory() || (await fs.readdir(outputDir)).length > 0) {
      throw new FeatureContextError("OUTPUT_EXISTS");
    }
  } catch (error) {
    if (error instanceof FeatureContextError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
