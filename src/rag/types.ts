export type RawChunk = {
  id: string
  docId: string
  docName: string
  heading: string
  text: string
}

/** 向量记录：id 与块 id 一一对应，Float32Array 由 IndexedDB 结构化克隆直接存储 */
export type VectorRecord = {
  id: string
  docId: string
  // bge-small-zh-v1.5 输出 512 维；1000 块约 2MB
  vector: Float32Array
}

/** 每篇文档的索引覆盖情况（块数 vs 已向量化的块数），用于 UI 判断是否待索引 */
export type IndexSummary = Record<string, { chunks: number; vectors: number }>
