// LLM 生成：浏览器直调 OpenAI 兼容 Chat Completions（SSE 流式），无后端中转。
// Key 明文存 localStorage —— 仅限本地学习项目，生产环境绝不能这么干。

import type { RetrievedChunk } from '../types'

export type LlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const STORAGE_KEY = 'minirag.llm'

export function loadLlmConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LlmConfig>
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) return null
    return { baseUrl: parsed.baseUrl, apiKey: parsed.apiKey, model: parsed.model }
  } catch {
    return null
  }
}

export function saveLlmConfig(config: LlmConfig | null): void {
  if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  else localStorage.removeItem(STORAGE_KEY)
}

// 每段上下文带 [n] 编号，配合 system 指令要求模型引用编号，
// 前端把编号映射回来源卡片——与 ChatPage 渲染的 [n] 顺序一致
export function buildMessages(question: string, chunks: RetrievedChunk[]): ChatCompletionMessage[] {
  const context = chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.docName} · ${chunk.heading}\n${chunk.text}`)
    .join('\n\n')

  return [
    {
      role: 'system',
      content:
        '你是一个知识库问答助手。只能依据用户提供的编号上下文段落回答；' +
        '引用了某段内容就在其后标注来源编号 [n]（可多个）。' +
        '上下文不足以回答时直说，不要编造上下文之外的信息。用简体中文回答。',
    },
    { role: 'user', content: `上下文：\n\n${context}\n\n问题：${question}` },
  ]
}

export type StreamHandlers = {
  onDelta: (delta: string) => void
  onDone: () => void
  onError: (error: Error) => void
}

/** 流式调用；不 await 完成可传 AbortSignal。所有失败都走 onError，不抛异常 */
export async function streamAnswer(
  config: LlmConfig,
  messages: ChatCompletionMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { onDelta, onDone, onError } = handlers
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages, stream: true }),
      signal,
    })

    if (!response.ok) {
      // 服务端错误信息里不会包含我们的 Key，可以原样透出帮助排查
      const detail = await response.text().catch(() => '')
      throw new Error(`API 返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
    }
    if (!response.body) throw new Error('响应没有可读流（浏览器兼容问题）')

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      // SSE 以空行分帧；末帧可能不完整，留在 buffer 里等下一个 chunk
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of frame.split('\n')) {
          const payload = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : ''
          if (!payload) continue
          if (payload === '[DONE]') {
            onDone()
            return
          }
          try {
            const parsed = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[]
            }
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) onDelta(delta)
          } catch {
            // 注释帧/keep-alive 不是 JSON，跳过即可
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
    onDone()
  } catch (error) {
    // 用户主动停止不算失败，UI 已保留生成的部分
    if (error instanceof DOMException && error.name === 'AbortError') {
      onDone()
      return
    }
    onError(error instanceof Error ? error : new Error('生成失败'))
  }
}
