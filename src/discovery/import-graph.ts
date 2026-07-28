/**
 * @feature-context
 * @feature feature discovery, import graph, dependency traversal
 * @role 索引内importをproject相対pathへ解決し、依存先と利用元を循環安全に展開する
 * @entry buildImportGraph, expandImportGraph
 * @flow DiscoveryIndex -> internal path resolution -> graph edges -> breadth-first expansion
 * @related imports.ts, file-index.ts, types.ts
 * @caution 外部packageと解決不能aliasを関連fileとして扱わず、誤ったedgeを作らない
 */

import path from "node:path";
import type {
  DiscoveryFile,
  DiscoveryIndex,
  ImportEdge,
  ImportGraph,
  ImportGraphDirection,
  ImportGraphExpansionOptions,
  ImportGraphRelation,
  IndexedImport
} from "./types.js";

const sourceExtensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cs",
  ".rb",
  ".php"
];

export function buildImportGraph(index: DiscoveryIndex): ImportGraph {
  const resolver = new ProjectImportResolver(index);
  const edges: ImportEdge[] = [];
  const unresolved: ImportGraph["unresolved"] = [];
  const seen = new Set<string>();

  for (const file of index.files) {
    for (const reference of file.imports) {
      const targets = resolver.resolve(file, reference);
      if (targets.length === 0) {
        if (isInternalCandidate(file, reference, resolver)) {
          unresolved.push({
            from: file.path,
            specifier: reference.specifier,
            line: reference.line
          });
        }
        continue;
      }
      for (const target of targets) {
        if (target === file.path) continue;
        const key = `${file.path}\0${target}\0${reference.kind}\0${reference.specifier}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          from: file.path,
          to: target,
          specifier: reference.specifier,
          kind: reference.kind,
          line: reference.line
        });
      }
    }
  }

  return {
    edges: edges.sort(compareEdges),
    unresolved: unresolved.sort(
      (left, right) =>
        left.from.localeCompare(right.from, "en") ||
        left.line - right.line ||
        left.specifier.localeCompare(right.specifier, "en")
    )
  };
}

export function expandImportGraph(
  graph: ImportGraph,
  seedPaths: string[],
  options: ImportGraphExpansionOptions = {}
): ImportGraphRelation[] {
  const maxDepth = options.maxDepth ?? 2;
  const directions = options.directions ?? ["dependency", "dependent"];
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error("import graphの展開depthが不正です。");
  }
  const seedSet = new Set(seedPaths.map(normalizePath));
  const queue = [...seedSet].sort().map((path) => ({ path, depth: 0 }));
  const visited = new Set(seedSet);
  const result: ImportGraphRelation[] = [];
  const outgoing = groupEdges(graph.edges, "from");
  const incoming = groupEdges(graph.edges, "to");

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    for (const direction of directions) {
      const relations =
        direction === "dependency"
          ? outgoing.get(current.path) ?? []
          : incoming.get(current.path) ?? [];
      for (const edge of relations) {
        const target = direction === "dependency" ? edge.to : edge.from;
        if (visited.has(target)) continue;
        visited.add(target);
        const relation: ImportGraphRelation = {
          path: target,
          via: current.path,
          depth: current.depth + 1,
          direction,
          edge
        };
        result.push(relation);
        queue.push({ path: target, depth: relation.depth });
      }
    }
  }
  return result;
}

class ProjectImportResolver {
  private readonly paths: Set<string>;
  private readonly goModule: string | null;
  private readonly javaTypes = new Map<string, string>();
  private readonly csharpTypes = new Map<string, string>();

  constructor(private readonly index: DiscoveryIndex) {
    this.paths = new Set(index.files.map((file) => file.path));
    this.goModule =
      index.files
        .find((file) => file.path === "go.mod")
        ?.sample.match(/(?:^|\n)\s*module\s+(\S+)/)?.[1] ?? null;
    for (const file of index.files) {
      if (file.language === "java") {
        const packageName = file.sample.match(/(?:^|\n)\s*package\s+([\w.]+)\s*;/)?.[1];
        const typeName = file.symbols.find((symbol) =>
          ["class", "interface", "enum", "record"].includes(symbol.kind)
        )?.name;
        if (packageName && typeName) this.javaTypes.set(`${packageName}.${typeName}`, file.path);
      }
      if (file.language === "csharp") {
        const namespace = file.sample.match(/(?:^|\n)\s*namespace\s+([\w.]+)/)?.[1];
        for (const symbol of file.symbols) {
          if (namespace) this.csharpTypes.set(`${namespace}.${symbol.name}`, file.path);
        }
      }
    }
  }

  resolve(file: DiscoveryFile, reference: IndexedImport): string[] {
    switch (file.language) {
      case "typescript":
      case "javascript":
      case "ruby":
      case "php":
        return this.resolvePathLike(file.path, reference.specifier);
      case "python":
        return this.resolvePython(file.path, reference.specifier);
      case "go":
        return this.resolveGo(reference.specifier);
      case "rust":
        return this.resolveRust(file.path, reference);
      case "java":
        return this.javaTypes.has(reference.specifier.replace(/\.\*$/, ""))
          ? [this.javaTypes.get(reference.specifier.replace(/\.\*$/, ""))!]
          : [];
      case "csharp":
        return this.csharpTypes.has(reference.specifier)
          ? [this.csharpTypes.get(reference.specifier)!]
          : [];
      default:
        return [];
    }
  }

  hasGoModulePrefix(specifier: string): boolean {
    return Boolean(this.goModule && specifier.startsWith(`${this.goModule}/`));
  }

  private resolvePathLike(fromPath: string, specifier: string): string[] {
    if (!specifier.startsWith(".")) return [];
    const base = normalizePath(path.posix.join(path.posix.dirname(fromPath), specifier));
    return this.matchPathCandidates(base);
  }

  private resolvePython(fromPath: string, specifier: string): string[] {
    const leadingDots = specifier.match(/^\.+/)?.[0].length ?? 0;
    const moduleName = specifier.slice(leadingDots);
    let baseDirectory = leadingDots > 0 ? path.posix.dirname(fromPath) : "";
    for (let level = 1; level < leadingDots; level += 1) {
      baseDirectory = path.posix.dirname(baseDirectory);
    }
    const modulePath = moduleName.replaceAll(".", "/");
    const base = normalizePath(path.posix.join(baseDirectory, modulePath));
    return this.matchPythonCandidates(base);
  }

  private resolveGo(specifier: string): string[] {
    let packagePath = "";
    if (this.goModule && specifier === this.goModule) packagePath = "";
    else if (this.goModule && specifier.startsWith(`${this.goModule}/`)) {
      packagePath = specifier.slice(this.goModule.length + 1);
    } else {
      return [];
    }
    const directory = normalizePath(packagePath);
    return [...this.paths]
      .filter(
        (candidate) =>
          path.posix.dirname(candidate) === directory &&
          candidate.endsWith(".go") &&
          !candidate.endsWith("_test.go")
      )
      .sort();
  }

  private resolveRust(fromPath: string, reference: IndexedImport): string[] {
    if (reference.kind === "module") {
      const base = path.posix.join(path.posix.dirname(fromPath), reference.specifier);
      return this.firstExisting([`${base}.rs`, `${base}/mod.rs`]);
    }
    const parts = reference.specifier.split("::");
    let base: string;
    if (parts[0] === "crate") {
      base = path.posix.join("src", ...parts.slice(1));
    } else if (parts[0] === "self") {
      base = path.posix.join(path.posix.dirname(fromPath), ...parts.slice(1));
    } else if (parts[0] === "super") {
      base = path.posix.join(path.posix.dirname(path.posix.dirname(fromPath)), ...parts.slice(1));
    } else {
      return [];
    }
    const candidates: string[] = [];
    const segments = normalizePath(base).split("/");
    while (segments.length > 1) {
      const value = segments.join("/");
      candidates.push(`${value}.rs`, `${value}/mod.rs`);
      segments.pop();
    }
    return this.firstExisting(candidates);
  }

  private matchPathCandidates(base: string): string[] {
    const extension = path.posix.extname(base);
    const withoutExtension = extension ? base.slice(0, -extension.length) : base;
    const candidates = [
      base,
      ...sourceExtensions.map((candidateExtension) => `${withoutExtension}${candidateExtension}`),
      ...sourceExtensions.map((candidateExtension) => `${base}/index${candidateExtension}`)
    ];
    return this.firstExisting(candidates);
  }

  private matchPythonCandidates(base: string): string[] {
    return this.firstExisting([`${base}.py`, `${base}/__init__.py`]);
  }

  private firstExisting(candidates: string[]): string[] {
    const found = candidates.map(normalizePath).find((candidate) => this.paths.has(candidate));
    return found ? [found] : [];
  }
}

function isInternalCandidate(
  file: DiscoveryFile,
  reference: IndexedImport,
  resolver: ProjectImportResolver
): boolean {
  if (reference.specifier.startsWith(".")) return true;
  if (file.language === "rust" && /^(?:crate|self|super)::/.test(reference.specifier)) return true;
  return file.language === "go" && resolver.hasGoModulePrefix(reference.specifier);
}

function groupEdges(
  edges: ImportEdge[],
  key: "from" | "to"
): Map<string, ImportEdge[]> {
  const groups = new Map<string, ImportEdge[]>();
  for (const edge of edges) {
    const items = groups.get(edge[key]) ?? [];
    items.push(edge);
    groups.set(edge[key], items);
  }
  for (const items of groups.values()) items.sort(compareEdges);
  return groups;
}

function compareEdges(left: ImportEdge, right: ImportEdge): number {
  return (
    left.from.localeCompare(right.from, "en") ||
    left.to.localeCompare(right.to, "en") ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind)
  );
}

function normalizePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\/+/, "");
  return normalized === "." ? "" : normalized;
}
