// 混合检索：向量语义召回 + 现有关键词（bigram）召回，用 RRF 融合排名。
// RRF 只看名次不看分值，天然回避了「余弦 0.8 和词频 12 怎么比」的量纲问题。

import { retrieve } from '../retrieval'
import type { Doc, RetrievedChunk } from '../types'
import { embedQuery } from './embed'
import { loadChunksWithVectors } from './db'

// 每条通道各取前 CANDIDATE_SIZE 个候选，融合后再截断到 FINAL_TOP_K
const CANDIDATE_SIZE = 10
// RRF 平滑常数：经验值 60，让头部名次的边际收益不过分陡峭
const RRF_K = 60
const FINAL_TOP_K = 3

export type HybridResult = {
  results: RetrievedChunk[]
  // hybrid = 向量+关键词都生效；keyword = 只有关键词（未索引或向量通道失败）
  mode: 'hybrid' | 'keyword'
  // mode 为 keyword 时说明退化原因，UI 据此提示用户
  reason?: string
}

/** 向量已 L2 归一化，点积即余弦相似度 */
function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]
  return sum
}

export async function hybridSearch(docs: Doc[], question: string): Promise<HybridResult> {
  const keywordHits = retrieve(docs, question, CANDIDATE_SIZE)

  let vectorHits: RetrievedChunk[] = []
  let reason: string | undefined

  try {
    const entries = await loadChunksWithVectors()
    if (entries.length === 0) {
      reason = '文档还没有建立向量索引，本次仅关键词检索。'
    } else {
      const queryVector = await embedQuery(question)
      vectorHits = entries
        .map((entry) => ({ ...entry.chunk, score: cosine(queryVector, entry.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, CANDIDATE_SIZE)
    }
  } catch (error) {
    // 模型加载/编码失败不能把整个检索拖垮，退化为纯关键词并如实告知
    reason = `向量检索失败（${error instanceof Error ? error.message : '未知错误'}），本次仅关键词检索。`
  }

  if (vectorHits.length === 0) {
    return {
      results: keywordHits.slice(0, FINAL_TOP_K),
      mode: 'keyword',
      reason,
    }
  }

  // RRF 融合：同一块可能在两条通道都出现，贡献按 1/(k+名次) 累加
  const fused = new Map<string, { chunk: RetrievedChunk; score: number }>()
  for (const hits of [keywordHits, vectorHits]) {
    hits.forEach((chunk, rank) => {
      const contribution = 1 / (RRF_K + rank + 1)
      const existing = fused.get(chunk.id)
      if (existing) {
        existing.score += contribution
      } else {
        fused.set(chunk.id, { chunk, score: contribution })
      }
    })
  }

  const results = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, FINAL_TOP_K)
    .map((entry) => ({ ...entry.chunk, score: entry.score }))

  return { results, mode: 'hybrid' }
}
