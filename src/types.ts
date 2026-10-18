export type Doc = {
  id: string
  name: string
  size: number
  content: string
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
