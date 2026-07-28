/**
 * @feature-context
 * @feature feature discovery, local context selection, application facade
 * @role 安全な索引・import graph・説明可能な順位付けを1回のlocal use caseとして提供する
 * @entry discoverFeature
 * @flow project root + feature query -> index -> graph -> ranking
 * @related file-index.ts, import-graph.ts, ranker.ts
 * @caution 外部AI送信と成果物書き込みを行わないlocal-only facadeを維持する
 */

import { buildDiscoveryIndex } from "./file-index.js";
import { buildImportGraph } from "./import-graph.js";
import { rankDiscoveryIndex } from "./ranker.js";
import type {
  DiscoverFeatureOptions,
  FeatureDiscoveryResult
} from "./types.js";

export async function discoverFeature(
  projectRoot: string,
  feature: string,
  options: DiscoverFeatureOptions = {},
  signal?: AbortSignal
): Promise<FeatureDiscoveryResult> {
  const index = await buildDiscoveryIndex(projectRoot, options.indexLimits, signal);
  const graph = buildImportGraph(index);
  const ranking = await rankDiscoveryIndex(index, graph, feature, options.ranking);
  return { index, graph, ranking };
}
