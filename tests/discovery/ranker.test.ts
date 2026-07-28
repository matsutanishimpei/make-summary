import { describe, expect, it } from "vitest";
import {
  buildImportGraph,
  expandDiscoveryQuery,
  extractComments,
  extractImports,
  extractSymbols,
  parseStructuredFileComment,
  rankDiscoveryIndex
} from "../../src/discovery/index.js";
import type {
  DiscoveryFile,
  DiscoveryIndex,
  DiscoveryLanguage
} from "../../src/discovery/index.js";

describe("explainable discovery ranking", () => {
  it("日本語queryを関連語へ展開し、comment・symbol・pathを根拠化する", async () => {
    const index = createIndex({
      "src/pages/LoginPage.tsx": `/**
 * @feature-context
 * @feature ログイン, authentication
 * @role credentialを入力して認証を開始する
 * @entry LoginPage
 */
import { authenticate } from "../services/AuthService";
export function LoginPage() { return authenticate(); }
`,
      "src/services/AuthService.ts": `
import { encrypt } from "../crypto/CryptoStore";
// credentialを検証する
export async function authenticate() { return encrypt(); }
`,
      "src/crypto/CryptoStore.ts": "export function encrypt() { return true; }",
      "src/utils/DateUtil.ts": "export function formatDate() { return ''; }"
    });
    const graph = buildImportGraph(index);

    const ranking = await rankDiscoveryIndex(index, graph, "ログイン機能", {
      maxResults: 10,
      graphDepth: 2
    });

    expect(ranking.query.concepts).toContain("authentication");
    expect(ranking.query.terms.map((term) => term.value)).toEqual(
      expect.arrayContaining(["ログイン", "login", "auth", "credential"])
    );
    expect(ranking.files[0].path).toBe("src/pages/LoginPage.tsx");
    expect(ranking.files[0].evidence.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["structured-feature", "role", "path", "symbol"])
    );
    const crypto = ranking.files.find((file) => file.path === "src/crypto/CryptoStore.ts");
    expect(crypto).toMatchObject({ relation: "dependency", direct: false });
    expect(crypto?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "graph-dependency", depth: 2 })
      ])
    );
    const date = ranking.files.find((file) => file.path === "src/utils/DateUtil.ts");
    expect(date?.relation).toBe("fallback");
    for (const file of ranking.files) {
      expect(file.score).toBe(
        file.evidence.reduce((total, evidence) => total + evidence.score, 0)
      );
    }
  });

  it("同点をpath順にし、全候補へ根拠を返す", async () => {
    const index = createIndex({
      "src/b.ts": "export const b = 1;",
      "src/a.ts": "export const a = 1;"
    });
    const ranking = await rankDiscoveryIndex(
      index,
      buildImportGraph(index),
      "未知の業務",
      { maxResults: 10 }
    );

    expect(ranking.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(ranking.files.every((file) => file.evidence.length > 0)).toBe(true);
    expect(ranking.warnings.join("\n")).toContain("直接一致");
  });

  it("maxResultsとminScoreを適用する", async () => {
    const index = createIndex({
      "src/Login.ts": "export function Login() {}",
      "src/Auth.ts": "export function Auth() {}",
      "src/Other.ts": "export function Other() {}"
    });
    const ranking = await rankDiscoveryIndex(index, buildImportGraph(index), "login", {
      maxResults: 1,
      minScore: 100
    });
    expect(ranking.files).toHaveLength(1);
    expect(ranking.files[0].path).toBe("src/Login.ts");
  });
});

describe("expandDiscoveryQuery", () => {
  it("一般語を除外しoriginal termをrelated termより重くする", () => {
    const query = expandDiscoveryQuery("ログイン機能について調査");
    expect(query.terms.find((term) => term.value === "ログイン")).toMatchObject({
      origin: "original",
      weight: 1
    });
    expect(query.terms.find((term) => term.value === "auth")).toMatchObject({
      origin: "related",
      weight: 0.6
    });
    expect(query.terms.some((term) => term.value === "機能")).toBe(false);
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
  const language: DiscoveryLanguage = filePath.endsWith(".py") ? "python" : "typescript";
  const structuredComment = parseStructuredFileComment(sample);
  const comments = extractComments(sample);
  const symbols = extractSymbols(sample, language);
  const imports = extractImports(sample, language);
  return {
    path: filePath,
    size: sample.length,
    language,
    sample,
    truncated: false,
    symbols,
    comments,
    imports,
    structuredComment,
    searchText: [
      filePath,
      ...(structuredComment?.features ?? []),
      structuredComment?.role ?? "",
      ...symbols.map((symbol) => symbol.name),
      ...comments.map((comment) => comment.text)
    ]
      .join("\n")
      .toLowerCase()
  };
}
