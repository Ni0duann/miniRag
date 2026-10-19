// 纯浏览器 ChatTransport：useChat 的 sendMessages 直接在本文件完成「检索 → 生成」，
// 不经过任何 HTTP chat 端点；产出标准 UI 消息流（createUIMessageStream），
// ChatPage 只管渲染流，不再手写 delta 累加。
// 检索命中片段以 data-sources 数据部分随流下发，前端据此渲染引用卡片，
// 顺序与 buildUserPrompt 的 [n] 编号一致。

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  APICallError,
  createUIMessageStream,
  streamText,
  toUIMessageStream,
  type ChatTransport,
  type UIMessage,
  type UIMessageStreamWriter,
} from 'ai'
import type { Doc, RetrievedChunk } from '../types'
import { buildUserPrompt, loadLlmConfig, SYSTEM_PROMPT } from './answer'
import { hybridSearch } from './search'

export type SourcesData = RetrievedChunk[]

/** ChatPage 的 docs 是 React 状态，transport 用 getter 在发送时刻取最新值 */
export function createRagTransport(getDocs: () => Doc[]): ChatTransport<UIMessage> {
  return {
    sendMessages: async ({ messages, abortSignal }) =>
      createUIMessageStream<UIMessage>({
        execute: async ({ writer }) => {
          const question = lastUserText(messages)
          const docs = getDocs()

          // 「没有可检索文档」：直接给引导文案
          if (docs.length === 0) {
            writeFallbackMessage(writer, '还没有可检索的文档，请先在「文档」页上传文件。')
            return
          }

          // 检索阶段：不发 start chunk，status 保持 submitted（UI 显示「检索中」）；
          // start 一到 useChat 就切 streaming 并放开「停止」，提前发会让停止发生在任何文本之前
          const outcome = await hybridSearch(docs, question)
          if (outcome.results.length === 0) {
            writeFallbackMessage(writer, '没有在已上传的文档中找到相关内容，试试换个关键词。')
            return
          }

          // 从这里开始有真实内容可展示：开消息 → 挂引用卡片 → 流式正文
          writer.write({ type: 'start' })
          writer.write({ type: 'data-sources', data: outcome.results })

          const config = loadLlmConfig()
          if (!config) {
            // 未配置模型时保持仅检索模式（Step 4 行为），并引导去设置
            writeFallbackText(writer, `检索到 ${outcome.results.length} 个相关片段（${outcome.mode === 'hybrid' ? '混合检索' : '关键词检索'}）。` +
                `${outcome.mode === 'keyword' ? (outcome.reason ?? '') : ''}配置生成模型后，我会基于这些片段流式回答问题。`)
            return
          }

          // 每次现建 provider：baseUrl/key 可能刚被用户在设置面板改过，不缓存实例
          const provider = createOpenAICompatible({
            name: 'minirag-llm',
            baseURL: config.baseUrl.replace(/\/+$/, ''),
            apiKey: config.apiKey,
          })
          const result = streamText({
            model: provider(config.model),
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildUserPrompt(question, outcome.results) }],
            abortSignal,
            // 失败原因（余额/限流/模型名错）重试也不会变，直接透出，不默默重试 3 次
            maxRetries: 0,
          })
          // start 已由本文件统一发出（data-sources 要挂在消息开始后），模型流只续写正文
          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              sendStart: false,
              onError: formatError,
            }),
          )
        },
        // execute 抛出（检索 Worker 挂掉、fetch 网络错误等）也统一成 UI 可见的错误文本
        onError: formatError,
      }),
    // 纯内存流没有可重连的服务端会话，刷新后靠 IndexedDB 恢复
    reconnectToStream: async () => null,
  }
}

function lastUserText(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  return (
    lastUser?.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('') ?? ''
  )
}

// 检索前就结束的降级路径：完整生命周期 start → text → finish
function writeFallbackMessage(writer: UIMessageStreamWriter<UIMessage>, text: string): void {
  writer.write({ type: 'start' })
  writeFallbackText(writer, text)
}

// 已发出 start 的降级路径只补 text 部分 + finish，
// useChat 会像对待模型输出一样把它组装成 assistant 消息
function writeFallbackText(writer: UIMessageStreamWriter<UIMessage>, text: string): void {
  const id = 'fallback'
  writer.write({ type: 'text-start', id })
  writer.write({ type: 'text-delta', id, delta: text })
  writer.write({ type: 'text-end', id })
  writer.write({ type: 'finish' })
}

// 保持旧口径：HTTP 错误透出状态码和响应体片段（响应体不含我们的 Key，可原样展示）
function formatError(error: unknown): string {
  if (error instanceof APICallError) {
    const detail = typeof error.responseBody === 'string' ? error.responseBody : ''
    return `API 返回 ${error.statusCode}${detail ? `：${detail.slice(0, 200)}` : ''}`
  }
  return error instanceof Error ? error.message : '生成失败'
}
