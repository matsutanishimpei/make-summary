/**
 * @feature-context
 * @feature feature discovery, query expansion, synonym search, multilingual search
 * @role 日本語・英語の機能名を正規化し、説明可能な関連語へ決定的に展開する
 * @entry expandDiscoveryQuery, detectDiscoveryConcepts
 * @flow raw feature query or indexed text -> normalization -> concept match -> weighted related terms
 * @related ranker.ts, embedding.ts
 * @caution 関連語は候補発見の補助であり、完全一致と同じ重みを与えない
 */

import type {
  DiscoveryQuery,
  DiscoveryQueryTerm
} from "./types.js";

export interface DiscoveryConcept {
  id: string;
  terms: readonly string[];
}

export const DISCOVERY_CONCEPTS: readonly DiscoveryConcept[] = [
  {
    id: "authentication",
    terms: [
      "ログイン",
      "サインイン",
      "認証",
      "本人確認",
      "login",
      "signin",
      "auth",
      "authentication",
      "credential",
      "session",
      "token"
    ]
  },
  {
    id: "notification",
    terms: [
      "通知",
      "お知らせ",
      "プッシュ",
      "notification",
      "notify",
      "push",
      "alert",
      "inbox"
    ]
  },
  {
    id: "billing",
    terms: [
      "課金",
      "請求",
      "支払",
      "決済",
      "billing",
      "payment",
      "checkout",
      "invoice",
      "subscription"
    ]
  },
  {
    id: "account",
    terms: [
      "ユーザー",
      "利用者",
      "アカウント",
      "プロフィール",
      "user",
      "account",
      "profile",
      "member"
    ]
  },
  {
    id: "authorization",
    terms: [
      "権限",
      "認可",
      "管理者",
      "authorization",
      "permission",
      "role",
      "policy",
      "admin"
    ]
  },
  {
    id: "search",
    terms: ["検索", "絞り込み", "search", "filter", "query", "lookup"]
  },
  {
    id: "file-transfer",
    terms: [
      "アップロード",
      "ダウンロード",
      "添付",
      "upload",
      "download",
      "attachment",
      "file"
    ]
  },
  {
    id: "messaging",
    terms: [
      "チャット",
      "メッセージ",
      "会話",
      "chat",
      "message",
      "conversation",
      "thread"
    ]
  },
  {
    id: "settings",
    terms: ["設定", "構成", "環境設定", "settings", "configuration", "config", "preference"]
  },
  {
    id: "order",
    terms: ["注文", "商品", "カート", "order", "product", "cart", "purchase"]
  }
];

const ignoredTerms = new Set([
  "機能",
  "処理",
  "画面",
  "実装",
  "調査",
  "関連",
  "について",
  "フロー",
  "feature",
  "function",
  "screen",
  "implementation",
  "investigate",
  "related",
  "about",
  "flow",
  "page",
  "service"
]);
const ignoredJapaneseSubstrings = [
  "について",
  "機能",
  "処理",
  "画面",
  "実装",
  "調査",
  "関連",
  "フロー"
];

export function expandDiscoveryQuery(raw: string): DiscoveryQuery {
  const originalValues = tokenize(raw);
  const terms = new Map<string, DiscoveryQueryTerm>();
  for (const value of originalValues) {
    terms.set(value, { value, origin: "original", weight: 1 });
  }

  const matchedConcepts: string[] = [];
  for (const concept of DISCOVERY_CONCEPTS) {
    const normalizedConceptTerms = concept.terms.flatMap(tokenize);
    if (!originalValues.some((value) => normalizedConceptTerms.includes(value))) continue;
    matchedConcepts.push(concept.id);
    for (const value of normalizedConceptTerms) {
      if (terms.has(value)) continue;
      terms.set(value, {
        value,
        origin: "related",
        weight: 0.6,
        concept: concept.id
      });
    }
  }

  return {
    raw: raw.trim(),
    terms: [...terms.values()],
    concepts: matchedConcepts
  };
}

export function detectDiscoveryConcepts(value: string): string[] {
  const values = new Set(tokenize(value));
  return DISCOVERY_CONCEPTS.filter((concept) =>
    concept.terms
      .flatMap(tokenize)
      .some((term) => values.has(term))
  ).map((concept) => concept.id);
}

export function normalizeDiscoveryText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  let normalized = normalizeDiscoveryText(value);
  for (const ignored of ignoredJapaneseSubstrings) {
    normalized = normalized.replaceAll(ignored, " ");
  }
  return [
    ...new Set(
      normalized
        .split(" ")
        .map((term) => term.trim())
        .filter(
          (term) =>
            isUsefulLength(term) &&
            !ignoredTerms.has(term)
        )
    )
  ];
}

function isUsefulLength(value: string): boolean {
  return /[^\u0000-\u007f]/.test(value) ? value.length >= 2 : value.length >= 3;
}
