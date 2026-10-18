export type Doc = {
  id: string
  name: string
  size: number
  content: string
  // IndexedDB 主键是 UUID，恢复列表时靠它还原「最新在前」的顺序
  createdAt: number
}

export type RetrievedChunk = {
  id: string
  docId: string
  docName: string
  heading: string
  text: string
  score: number
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources?: RetrievedChunk[]
}
