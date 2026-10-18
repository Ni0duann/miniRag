// 入库管线：切块 → 存块 → 批量 Embedding → 写向量。
// 按计划「全部批次成功才写 vectors」：中途失败时块表可残留（重索引会覆盖），
// 但向量表要么完整要么为空，检索侧不必处理半索引状态。

import { chunkDocument } from './chunk'
import { embedTexts, type EmbedProgress } from './embed'
import { putChunks, putVectors } from './db'
import type { Doc } from '../types'

/** 索引一篇文档；返回块数。进度回调透传自 Worker */
export async function indexDocument(
  doc: Doc,
  onProgress?: (progress: EmbedProgress) => void,
): Promise<number> {
  const chunks = chunkDocument(doc)
  if (chunks.length === 0) return 0

  await putChunks(chunks)
  const vectors = await embedTexts(
    chunks.map((chunk) => chunk.text),
    onProgress,
  )
  await putVectors(
    chunks.map((chunk, i) => ({ id: chunk.id, docId: chunk.docId, vector: vectors[i] })),
  )
  return chunks.length
}
