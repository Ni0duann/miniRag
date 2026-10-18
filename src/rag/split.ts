// 递归分隔符切块（LangChain RecursiveCharacterTextSplitter 的零依赖实现）。
// 与 chunk.ts 的"标题感知流式切块"是互补策略：
// 本函数不关心 Markdown 结构，只按分隔符优先级把任意长文本切到目标尺寸内，
// 适合无结构纯文本，也可作为其他切块器的底层工具。

// 分隔符优先级：段落 → 行 → 中文句末 → 英文句末 → 词 → 字符级硬切
const DEFAULT_SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', '.', ' ', '']

export type SplitOptions = {
  /** 单块上限（字符数），重叠加回后也不得超过 */
  chunkSize?: number
  /** 相邻块之间重叠的字符数，保留跨块上下文 */
  chunkOverlap?: number
  /** 自定义分隔符优先级列表；建议以 '' 结尾作为字符级兜底 */
  separators?: string[]
}

/** 按 sep 切开文本，并把分隔符保留附在前一片尾部（保证逐片拼接不丢字符） */
function splitKeeping(text: string, sep: string): string[] {
  if (sep === '') return [...text]
  const parts = text.split(sep)
  const pieces: string[] = []
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]) pieces.push(i < parts.length - 1 ? parts[i] + sep : parts[i])
  }
  return pieces
}

export function splitBySeparators(text: string, options: SplitOptions = {}): string[] {
  const { chunkSize = 400, chunkOverlap = 60, separators = DEFAULT_SEPARATORS } = options
  if (chunkOverlap >= chunkSize) throw new Error('chunkOverlap 必须小于 chunkSize')
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= chunkSize) return [trimmed]

  // 深度优先：取第一个能真正拆细文本的分隔符；'' 保证最坏也能按字符拆
  const sep = separators.find((s) => s === '' || trimmed.includes(s)) ?? ''
  const pieces = splitKeeping(trimmed, sep)

  // 递归细切：某一片仍超限时，用更低优先级的剩余分隔符继续拆
  const restSeparators = separators.slice(separators.indexOf(sep) + 1)
  const atoms: string[] = []
  for (const piece of pieces) {
    if (piece.length <= chunkSize || restSeparators.length === 0) atoms.push(piece)
    else atoms.push(...splitBySeparators(piece, { chunkSize, chunkOverlap, separators: restSeparators }))
  }

  // 第一步：贪心合并原子片段，在不破 chunkSize 的前提下尽量填满，减少碎片
  const merged: string[] = []
  let current = ''
  for (const atom of atoms) {
    if (current && current.length + atom.length > chunkSize) {
      merged.push(current.trimEnd())
      current = atom
    } else {
      current += atom
    }
  }
  if (current.trim()) merged.push(current.trimEnd())

  // 第二步：统一加重叠——每块携带上一块尾部若干字符作为上文。
  // 先取上一块"去掉块间重复后"的原文尾部，避免重叠层层累积；
  // 再加预算检查，保证 块长+重叠 仍不破 chunkSize。
  if (chunkOverlap === 0) return merged
  const result: string[] = [merged[0]]
  for (let i = 1; i < merged.length; i += 1) {
    // merged[i] 的开头此时仍纯净（尚未被加过重叠），可直接取尾
    const prevCleanTail = merged[i - 1].slice(-chunkOverlap)
    const budget = Math.max(0, chunkSize - merged[i].length)
    const tail = prevCleanTail.slice(Math.max(0, prevCleanTail.length - budget))
    result.push(tail ? `${tail}${merged[i]}` : merged[i])
  }
  return result
}
