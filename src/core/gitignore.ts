import { promises as fs } from "node:fs";
import path from "node:path";
import createIgnore from "ignore";
import { FeatureContextError } from "./errors.js";

interface IgnoreScope {
  relativeDirectory: string;
  matcher: ReturnType<typeof createIgnore>;
}

export class GitIgnoreResolver {
  private readonly matcherCache = new Map<
    string,
    Promise<ReturnType<typeof createIgnore> | null>
  >();

  constructor(private readonly projectRoot: string) {}

  async isIgnored(relativePath: string, directory = false): Promise<boolean> {
    const normalized = normalizeIgnorePath(relativePath);
    if (!normalized) return false;

    const segments = normalized.split("/");
    const scopes: IgnoreScope[] = [];
    const rootMatcher = await this.loadMatcher("");
    if (rootMatcher) scopes.push({ relativeDirectory: "", matcher: rootMatcher });

    for (let index = 0; index < segments.length; index += 1) {
      const isTarget = index === segments.length - 1;
      const projectRelative = segments.slice(0, index + 1).join("/");
      const markedPath = !isTarget || directory ? `${projectRelative}/` : projectRelative;
      if (evaluateScopes(scopes, markedPath)) return true;

      if (!isTarget) {
        const matcher = await this.loadMatcher(projectRelative);
        if (matcher) scopes.push({ relativeDirectory: projectRelative, matcher });
      }
    }
    return false;
  }

  private loadMatcher(
    relativeDirectory: string
  ): Promise<ReturnType<typeof createIgnore> | null> {
    const cached = this.matcherCache.get(relativeDirectory);
    if (cached) return cached;
    const loading = this.readMatcher(relativeDirectory);
    this.matcherCache.set(relativeDirectory, loading);
    return loading;
  }

  private async readMatcher(
    relativeDirectory: string
  ): Promise<ReturnType<typeof createIgnore> | null> {
    const directory = relativeDirectory
      ? path.join(this.projectRoot, ...relativeDirectory.split("/"))
      : this.projectRoot;
    if (relativeDirectory) {
      try {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw readError(relativeDirectory, error);
      }
    }

    try {
      const patterns = await fs.readFile(path.join(directory, ".gitignore"), "utf8");
      return createIgnore().add(patterns);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw readError(relativeDirectory || ".", error);
    }
  }
}

function evaluateScopes(scopes: IgnoreScope[], projectRelativePath: string): boolean {
  let ignored = false;
  for (const scope of scopes) {
    const scopedPath = scope.relativeDirectory
      ? projectRelativePath.slice(scope.relativeDirectory.length + 1)
      : projectRelativePath;
    const result = scope.matcher.test(scopedPath);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

function normalizeIgnorePath(input: string): string | null {
  if (
    !input ||
    input.includes("\0") ||
    path.win32.isAbsolute(input) ||
    path.posix.isAbsolute(input)
  ) {
    return null;
  }
  const normalized = input.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (
    !segments.length ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return segments.join("/");
}

function readError(relativeDirectory: string, error: unknown): FeatureContextError {
  return new FeatureContextError(
    "READ_DENIED",
    `${relativeDirectory}/.gitignoreを読み取れません。`,
    error instanceof Error ? error.message : String(error)
  );
}
