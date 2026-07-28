import { describe, expect, it } from "vitest";
import {
  buildImportGraph,
  cosineSimilarity,
  LocalMultilingualEmbedding,
  rankDiscoveryIndex
} from "../../src/discovery/index.js";
import type {
  DiscoveryFile,
  DiscoveryIndex,
  EmbeddingProvider
} from "../../src/discovery/index.js";

describe("LocalMultilingualEmbedding", () => {
  it("日本語の機能名と英語の責務を同じ概念空間へ写す", async () => {
    const provider = new LocalMultilingualEmbedding();
    const [query, authentication, unrelated] = await provider.embed([
      "ログイン機能",
      "AuthService validates credentials and creates a session token",
      "Date formatter and calendar timezone utility"
    ]);

    const relatedSimilarity = cosineSimilarity(query, authentication);
    const unrelatedSimilarity = cosineSimilarity(query, unrelated);
    expect(relatedSimilarity).toBeGreaterThan(0.5);
    expect(relatedSimilarity).toBeGreaterThan(unrelatedSimilarity + 0.35);
  });

  it("同じ入力を決定的な正規化vectorへ変換する", async () => {
    const provider = new LocalMultilingualEmbedding(128);
    const [first, second, empty] = await provider.embed([
      "通知 notification",
      "通知 notification",
      ""
    ]);

    expect(first).toEqual(second);
    expect(vectorNorm(first)).toBeCloseTo(1, 10);
    expect(vectorNorm(empty)).toBe(0);
  });

  it("AbortSignalによるキャンセルを尊重する", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new LocalMultilingualEmbedding();

    await expect(provider.embed(["login"], controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});

describe("embedding ranking integration", () => {
  it("差し替えproviderの意味類似度を説明可能な根拠として加算する", async () => {
    const provider: EmbeddingProvider = {
      id: "test-semantic-provider",
      dimensions: 2,
      async embed(texts) {
        return texts.map((text) =>
          text.includes("semantic-only") ? [1, 0] : text === "opaque feature" ? [1, 0] : [0, 1]
        );
      }
    };
    const index = createIndex([
      createFile("src/Target.ts", "semantic-only responsibility"),
      createFile("src/Other.ts", "unrelated calendar")
    ]);

    const ranking = await rankDiscoveryIndex(
      index,
      buildImportGraph(index),
      "opaque feature",
      {
        embedding: provider,
        semanticThreshold: 0.8,
        semanticWeight: 200
      }
    );

    expect(ranking.embedding).toEqual({
      provider: "test-semantic-provider",
      dimensions: 2,
      threshold: 0.8,
      matchedFiles: 1
    });
    expect(ranking.files[0]).toMatchObject({
      path: "src/Target.ts",
      direct: true,
      relation: "direct"
    });
    expect(ranking.files[0].evidence).toContainEqual(
      expect.objectContaining({
        kind: "semantic",
        score: 200
      })
    );
  });

  it("provider異常時は警告を残して文字列順位へfallbackする", async () => {
    const provider: EmbeddingProvider = {
      id: "broken-provider",
      dimensions: 2,
      async embed() {
        throw new Error("model unavailable");
      }
    };
    const index = createIndex([createFile("src/Login.ts", "login")]);

    const ranking = await rankDiscoveryIndex(
      index,
      buildImportGraph(index),
      "login",
      { embedding: provider }
    );

    expect(ranking.files[0].path).toBe("src/Login.ts");
    expect(ranking.embedding).toBeUndefined();
    expect(ranking.warnings.join("\n")).toContain("model unavailable");
  });
});

function createIndex(files: DiscoveryFile[]): DiscoveryIndex {
  return {
    projectRoot: "C:/project",
    files,
    scannedFiles: files.length,
    scannedBytes: files.reduce((sum, file) => sum + file.size, 0),
    warnings: []
  };
}

function createFile(filePath: string, searchText: string): DiscoveryFile {
  return {
    path: filePath,
    size: searchText.length,
    language: "typescript",
    sample: "",
    truncated: false,
    symbols: [],
    comments: [],
    imports: [],
    structuredComment: null,
    searchText
  };
}

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}
