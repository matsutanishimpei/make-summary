import { describe, expect, it } from "vitest";
import {
  buildImportGraph,
  expandImportGraph,
  extractImports
} from "../../src/discovery/index.js";
import type {
  DiscoveryFile,
  DiscoveryIndex,
  DiscoveryLanguage
} from "../../src/discovery/index.js";

describe("import graph", () => {
  it("TypeScriptのrelative import・re-export・dynamic importを内部pathへ解決する", () => {
    const index = createIndex({
      "src/pages/LoginPage.tsx": `
import { login } from "../services/AuthService.js";
const dialog = import("../components/LoginDialog");
import React from "react";
`,
      "src/services/AuthService.ts": `
import { saveToken } from "../stores/TokenStore";
export async function login() { saveToken(); }
`,
      "src/stores/TokenStore.ts": "export const saveToken = () => {};",
      "src/components/LoginDialog/index.tsx": "export function LoginDialog() {}",
      "src/index.ts": 'export { login } from "./services/AuthService.js";'
    });

    const graph = buildImportGraph(index);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "src/pages/LoginPage.tsx",
          to: "src/services/AuthService.ts",
          kind: "static"
        }),
        expect.objectContaining({
          from: "src/pages/LoginPage.tsx",
          to: "src/components/LoginDialog/index.tsx",
          kind: "dynamic"
        }),
        expect.objectContaining({
          from: "src/services/AuthService.ts",
          to: "src/stores/TokenStore.ts"
        }),
        expect.objectContaining({
          from: "src/index.ts",
          to: "src/services/AuthService.ts",
          kind: "re-export"
        })
      ])
    );
    expect(graph.edges.some((edge) => edge.specifier === "react")).toBe(false);
    expect(graph.unresolved).toEqual([]);
  });

  it("依存先と利用元をdepth上限・cycle防止付きで展開する", () => {
    const index = createIndex({
      "src/LoginPage.ts": 'import "./AuthService";',
      "src/AuthService.ts": 'import "./TokenStore";',
      "src/TokenStore.ts": 'import "./AuthService";',
      "tests/AuthService.test.ts": 'import "../src/AuthService";'
    });
    const graph = buildImportGraph(index);

    const dependencies = expandImportGraph(graph, ["src/LoginPage.ts"], {
      maxDepth: 2,
      directions: ["dependency"]
    });
    const dependents = expandImportGraph(graph, ["src/AuthService.ts"], {
      maxDepth: 1,
      directions: ["dependent"]
    });

    expect(dependencies.map((relation) => [relation.path, relation.depth])).toEqual([
      ["src/AuthService.ts", 1],
      ["src/TokenStore.ts", 2]
    ]);
    expect(dependents.map((relation) => relation.path)).toEqual([
      "src/LoginPage.ts",
      "src/TokenStore.ts",
      "tests/AuthService.test.ts"
    ]);
  });

  it("Python relative importとGo module importを解決する", () => {
    const index = createIndex({
      "app/auth/login.py": "from ..stores.token import TokenStore",
      "app/stores/token.py": "class TokenStore: pass",
      "go.mod": "module example.com/product",
      "cmd/main.go": 'import "example.com/product/internal/auth"',
      "internal/auth/login.go": "package auth\nfunc Login() {}",
      "internal/auth/helper.go": "package auth\nfunc helper() {}"
    });
    const graph = buildImportGraph(index);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "app/auth/login.py",
          to: "app/stores/token.py"
        }),
        expect.objectContaining({
          from: "cmd/main.go",
          to: "internal/auth/login.go"
        }),
        expect.objectContaining({
          from: "cmd/main.go",
          to: "internal/auth/helper.go"
        })
      ])
    );
  });

  it("解決できないrelative importを記録する", () => {
    const graph = buildImportGraph(
      createIndex({ "src/Login.ts": 'import { missing } from "./missing";' })
    );
    expect(graph.unresolved).toEqual([
      { from: "src/Login.ts", specifier: "./missing", line: 1 }
    ]);
  });
});

function createIndex(files: Record<string, string>): DiscoveryIndex {
  const indexedFiles = Object.entries(files).map(([filePath, sample]) =>
    createFile(filePath, sample)
  );
  return {
    projectRoot: "C:/project",
    files: indexedFiles.sort((left, right) => left.path.localeCompare(right.path, "en")),
    scannedFiles: indexedFiles.length,
    scannedBytes: indexedFiles.reduce((total, file) => total + file.size, 0),
    warnings: []
  };
}

function createFile(filePath: string, sample: string): DiscoveryFile {
  const language = languageFor(filePath);
  return {
    path: filePath,
    size: sample.length,
    language,
    sample,
    truncated: false,
    symbols: [],
    comments: [],
    imports: extractImports(sample, language),
    structuredComment: null,
    searchText: sample.toLowerCase()
  };
}

function languageFor(filePath: string): DiscoveryLanguage {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".go") || filePath === "go.mod") return "go";
  return "typescript";
}
