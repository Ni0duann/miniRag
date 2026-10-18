import type { Doc } from '../types'
import type { RawChunk } from './types'

// 软阈值：缓冲超过该长度后，遇到空行（自然段落边界）就切块
const CHUNK_SIZE = 400
// 硬上限：单块绝对不能超过的长度，防止无换行的超长段落撑爆
const MAX_CHUNK_SIZE = 800
// 重叠窗口：上一块被硬切时，尾部文字会重叠进下一块，保留跨块上下文
const OVERLAP_SIZE = 80

/**
 * 把一篇文档切成若干块（RAG 检索的最小单元）。
 * 策略：标题感知 + 段落优先 + 硬上限兜底 + 重叠续接。
 */
export function chunkDocument(doc: Doc): RawChunk[] {
  const chunks: RawChunk[] = []
  let heading = '正文' // 当前所处的小节标题，随 Markdown 标题行切换
  let buffer = '' // 正在积累的块文本

  // 生成一个块并编号；id 采用 文档id-序号，保证与文档生命周期一致
  const emit = (text: string) => chunks.push({
    id: `${doc.id}-${chunks.length}`,
    docId: doc.id,
    docName: doc.name,
    heading,
    text,
  })

  /**
   * 硬上限裁剪：超过 MAX_CHUNK_SIZE 时，在窗口内找最后一个句末标点
   * （中英文句号/问号/叹号/换行）作为切点，尽量不切断句子；
   * 找不到标点才硬截断。
   */
  const trimToLimit = (text: string) => {
    if (text.length <= MAX_CHUNK_SIZE) return text
    const window = text.slice(0, MAX_CHUNK_SIZE)
    let cut = -1
    for (const p of ['。', '！', '？', '?', '!', '.', '\n']) {
      cut = Math.max(cut, window.lastIndexOf(p))
    }
    return cut === -1 ? window : window.slice(0, cut + 1)
  }

  /**
   * 落盘当前缓冲。
   * @param carryOverlap 是否把被裁掉的尾部续接到下一块。
   * 边界场景：只有"尺寸触发"的切块才重叠；"标题/文档结尾触发"不重叠，
   * 否则会把上一小节的内容带进新小节，污染检索结果。
   */
  const flush = (carryOverlap: boolean) => {
    const raw = buffer.trim()
    buffer = ''
    if (!raw) return

    const text = trimToLimit(raw)
    emit(text)

    if (carryOverlap && text.length < raw.length) {
      const tail = raw.slice(text.length)
      // 尾部本身仍超限时，递归继续切，保证每块都不破硬上限
      if (tail.length > OVERLAP_SIZE) {
        buffer = tail
        flush(carryOverlap)
      } else {
        // 否则作为重叠块单独发出：内容与上一块尾部重复，检索命中任一块都不丢上下文
        emit(tail)
      }
    }
  }

  for (const line of doc.content.split(/\r?\n/)) {
    // Markdown 标题行：先结算旧小节，再切换 heading 上下文
    const match = /^#{1,6}\s+(.+)$/.exec(line)
    if (match) {
      flush(false)
      heading = match[1].trim() || '正文'
      continue
    }

    buffer += `${line}\n`
    // 达到软阈值且当前行是空行 → 在自然段落边界切块
    if (buffer.length >= CHUNK_SIZE && line.trim() === '') flush(true)
    // 达到硬上限 → 立即强制切块（应对超长无换行段落）
    else if (buffer.length >= MAX_CHUNK_SIZE) flush(true)
  }

  // 文档结尾：结算最后一块，无需重叠
  flush(false)
  return chunks
}

/** 批量切块：多篇文档合并成一个块列表 */
export function chunkDocuments(docs: Doc[]): RawChunk[] {
  return docs.flatMap(chunkDocument)
}
