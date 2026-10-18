import { chunkDocument } from './rag/chunk'
import type { Doc, RetrievedChunk } from './types'

const STOP_TERMS = new Set([
  '什么',
  '怎么',
  '如何',
  '为什么',
  '哪些',
  '这个',
  '那个',
  '请问',
  '一下',
  '是否',
  '可以',
])

function tokenize(question: string): string[] {
  const lower = question.toLowerCase()
  const terms = new Set<string>()

  for (const word of lower.match(/[a-z0-9][a-z0-9_-]*/g) ?? []) {
    if (word.length >= 2) terms.add(word)
  }

  for (const run of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) {
      if (!STOP_TERMS.has(run)) terms.add(run)
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2)
      if (!STOP_TERMS.has(bigram)) terms.add(bigram)
    }
  }

  return [...terms]
}

function countOccurrences(haystack: string, needle: string) {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

export function retrieve(docs: Doc[], question: string, limit = 3): RetrievedChunk[] {
  const terms = tokenize(question)
  if (terms.length === 0) return []

  const scored: RetrievedChunk[] = []

  for (const doc of docs) {
    for (const chunk of chunkDocument(doc)) {
      const text = chunk.text.toLowerCase()
      const heading = chunk.heading.toLowerCase()
      let score = 0

      for (const term of terms) {
        score += countOccurrences(text, term)
        if (heading.includes(term)) score += 3
      }

      if (score > 0) scored.push({ ...chunk, score })
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}
