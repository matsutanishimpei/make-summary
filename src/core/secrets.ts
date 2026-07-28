export interface SensitiveContentFinding {
  kind: string;
}

const directPatterns: Array<{ kind: string; pattern: RegExp }> = [
  {
    kind: "秘密鍵",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/
  },
  {
    kind: "Google APIキー",
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/
  },
  {
    kind: "AWSアクセスキー",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    kind: "GitHubアクセストークン",
    pattern: /\b(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})\b/
  },
  {
    kind: "Slackトークン",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/
  },
  {
    kind: "Stripe秘密キー",
    pattern: /\bsk_live_[0-9A-Za-z]{20,}\b/
  },
  {
    kind: "OpenAI APIキー",
    pattern: /\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b/
  },
  {
    kind: "npmアクセストークン",
    pattern: /\bnpm_[0-9A-Za-z]{30,}\b/
  },
  {
    kind: "JWT",
    pattern: /\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\b/
  },
  {
    kind: "Bearerトークン",
    pattern: /\bBearer\s+[0-9A-Za-z._~+/-]{20,}={0,2}\b/i
  },
  {
    kind: "認証情報を含む接続URL",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:[^@\s/]{8,}@/i
  }
];

const assignedSecretPattern =
  /(?:^|[^\p{L}\p{N}_])["']?(?:api[_-]?key|secret|token|(?:auth|access|refresh)[_-]?token|password|passwd|client[_-]?secret|private[_-]?key|account[_-]?key)["']?\s*[:=]\s*(["'`])([^"'`\r\n]{12,})\1/gimu;

const placeholderPattern =
  /(?:example|sample|dummy|placeholder|replace|your[-_ ]|xxxx|redacted|mock|fake|test[-_ ]|never[-_ ]|not[-_ ]a[-_ ]|do[-_ ]not[-_ ]|process\.env|import\.meta\.env|\$\{|<[^>]+>)/i;

export function findSensitiveContent(content: string): SensitiveContentFinding | null {
  for (const candidate of directPatterns) {
    if (candidate.pattern.test(content)) return { kind: candidate.kind };
  }

  assignedSecretPattern.lastIndex = 0;
  for (const match of content.matchAll(assignedSecretPattern)) {
    const value = match[2].trim();
    if (placeholderPattern.test(value) || /^(?:true|false|null|undefined)$/i.test(value)) continue;
    if (new Set(value).size < 6) continue;
    return { kind: "コード内へ直接記述された認証情報" };
  }
  return null;
}
