import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources'
import { createRagTransport, type SourcesData } from '../rag/chatTransport'
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from '../rag/answer'
import { clearMessages, loadMessages, putMessage } from '../rag/db'
import { fileBadge } from '../docs'
import type { ChatMessage, Doc } from '../types'

type Props = {
  docs: Doc[]
}

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.4-.6L3 21l1.7-4.6a8.1 8.1 0 0 1-1-4A8.4 8.4 0 0 1 12 4a8.4 8.4 0 0 1 9 7.5Z" />
    </svg>
  )
}

function formatScore(score: number): string {
  // 关键词通道是整数出现次数，向量通道 RRF 融合分是小数，分别格式化
  return Number.isInteger(score) ? String(score) : score.toFixed(4)
}

// useChat 的 parts 是开放联合类型，这里按约定取 text / data-sources 两类
function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

// 默认 UIMessage 的 parts 是宽联合，data-sources 需要我们自己的收窄
type SourcesPart = { type: 'data-sources'; data: SourcesData }

function isSourcesPart(part: UIMessage['parts'][number]): part is SourcesPart {
  return part.type === 'data-sources'
}

function messageSources(message: UIMessage): SourcesData | undefined {
  return message.parts.find(isSourcesPart)?.data
}

// 从 IndexedDB 的扁平 ChatMessage 重建 useChat 需要的 UIMessage parts
function toUIMessage(row: ChatMessage): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: [
      { type: 'text', text: row.text },
      ...(row.sources ? [{ type: 'data-sources' as const, data: row.sources }] : []),
    ],
  }
}

// DeepSeek 官方 OpenAI 兼容端点；V4 系列 API 调用名为 deepseek-v4-flash（旧名 deepseek-chat 已停用）
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-v4-flash'

// 模块级快照：transport 只在「发送那一刻」读最新文档列表。
// 用普通变量而非 ref/可变 state，既避开渲染期触碰 ref，也不违反 React Compiler 的不可变假设
//（全站只有 ChatPage 挂载时读写，StrictMode 双挂载写的是同一份 docs）
let docsSnapshot: Doc[] = []

function ChatPage({ docs }: Props) {
  const [draft, setDraft] = useState('')
  const [config, setConfig] = useState<LlmConfig | null>(() => loadLlmConfig())
  const [showSettings, setShowSettings] = useState(false)
  const [baseUrl, setBaseUrl] = useState(() => loadLlmConfig()?.baseUrl ?? DEFAULT_BASE_URL)
  const [apiKey, setApiKey] = useState(() => loadLlmConfig()?.apiKey ?? '')
  const [model, setModel] = useState(() => loadLlmConfig()?.model ?? DEFAULT_MODEL)

  useEffect(() => {
    docsSnapshot = docs
  }, [docs])
  // transport 只建一次，useChat 持有的实例保持稳定
  const [transport] = useState(() => createRagTransport(() => docsSnapshot))

  // 已落库的消息 id：onFinish 时只补写新增的，避免整表反复 put
  const persistedRef = useRef<Set<string>>(new Set())

  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    transport,
    onFinish: ({ messages: settled, isError, isAbort }) => {
      // 生成失败的那轮不落库：库里留一条空 assistant 会让刷新后看起来像「答了个空」，
      // 而错误横幅只在内存里，用户无从知道这条空消息是怎么回事。中止（点停止）要保留，见 isAbort
      if (isError && !isAbort) return
      void persistMessages(settled)
    },
  })

  const busy = status !== 'ready'

  async function persistMessages(settled: UIMessage[]) {
    // 同一批内用递增序号拉开 createdAt，保证刷新后 user 在 assistant 之前
    let tick = 0
    for (const message of settled) {
      if (message.role === 'system' || persistedRef.current.has(message.id)) continue
      persistedRef.current.add(message.id)
      const row: ChatMessage = {
        id: message.id,
        role: message.role,
        text: messageText(message),
        sources: messageSources(message),
        createdAt: Date.now() + tick++,
      }
      // 写库失败只影响"刷新后是否还在"，不打断对话
      try {
        await putMessage(row)
      } catch {
        // ignore
      }
    }
  }

  useEffect(() => {
    // 聊天记录恢复失败不阻塞页面：大不了从空对话开始
    loadMessages()
      .then((rows) => {
        if (rows.length === 0) return
        rows.forEach((row) => persistedRef.current.add(row.id))
        setMessages(rows.map(toUIMessage))
      })
      .catch(() => {})
  }, [setMessages])

  function send() {
    const question = draft.trim()
    if (!question || busy) return
    setDraft('')
    void sendMessage({ text: question })
  }

  function clearConversation() {
    setMessages([])
    persistedRef.current.clear()
    void clearMessages().catch(() => {})
  }

  function saveSettings() {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) return
    const next = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() }
    saveLlmConfig(next)
    setConfig(next)
    setShowSettings(false)
  }

  function clearSettings() {
    saveLlmConfig(null)
    setConfig(null)
    setApiKey('')
  }

  return (
    <>
      <div className="header">
        <div className="header-top">
          <h1>知识问答</h1>
          <div className="header-actions">
            {messages.length > 0 && (
              <button type="button" className="ghost" onClick={clearConversation}>
                清空对话
              </button>
            )}
            <button type="button" className="ghost" onClick={() => setShowSettings((prev) => !prev)}>
              模型设置{config ? ' · 已配置' : ''}
            </button>
          </div>
        </div>
        <p className="subtitle">
          {docs.length > 0 ? `已加载 ${docs.length} 篇文档 · ` : ''}
          本地混合检索（向量 + 关键词）
          {config ? ` · ${config.model} 流式生成` : ' · 未配置生成模型'}
        </p>

        {showSettings && (
          <section className="panel settings-panel" aria-label="模型设置">
            <label className="settings-row">
              <span>Base URL</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={DEFAULT_BASE_URL}
                spellCheck={false}
              />
            </label>
            <label className="settings-row">
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                spellCheck={false}
              />
            </label>
            <label className="settings-row">
              <span>模型名</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={DEFAULT_MODEL}
                spellCheck={false}
              />
            </label>
            <p className="settings-note">
              Key 仅明文保存在本机 localStorage，提问时浏览器直连该 API，不经过任何中转服务器。
              仅限本地学习用途，勿用于生产。
            </p>
            <div className="settings-actions">
              <button
                type="button"
                className="link-btn"
                onClick={saveSettings}
                disabled={!baseUrl.trim() || !apiKey.trim() || !model.trim()}
              >
                保存
              </button>
              {config && (
                <button type="button" className="ghost" onClick={clearSettings}>
                  清除配置
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      <section className="panel chat-panel">
        <Conversation className="chat-conversation">
          <ConversationContent className="chat-body">
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<ChatIcon />}
                title="开始提问"
                description="输入问题，我会从已上传的文档中查找相关片段并生成回答。"
              >
                <span className="preview-icon">
                  <ChatIcon />
                </span>
                <p>输入问题，我会从已上传的文档中查找相关片段并生成回答。</p>
                {docs.length === 0 && (
                  <Link to="/" className="link-btn">
                    先上传文档
                  </Link>
                )}
              </ConversationEmptyState>
            ) : (
              messages.map((message) => {
                const text = messageText(message)
                const sources = messageSources(message)
                const streaming = status === 'streaming' && message.role === 'assistant'
                return (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {message.role === 'assistant' ? (
                        <>
                          {text ? (
                            <MessageResponse isAnimating={streaming}>{text}</MessageResponse>
                          ) : null}
                          {streaming && <span className="cursor" aria-hidden="true" />}
                        </>
                      ) : (
                        text
                      )}
                    </MessageContent>
                    {sources && sources.length > 0 && (
                      <Sources>
                        <SourcesTrigger count={sources.length}>
                          <span className="sources-summary">引用了 {sources.length} 个相关片段</span>
                        </SourcesTrigger>
                        <SourcesContent className="sources-content">
                          <ul className="sources">
                            {sources.map((source, index) => (
                              <li key={source.id} className="source">
                                <div className="source-head">
                                  <span className="source-index">[{index + 1}]</span>
                                  <span className="md-badge">{fileBadge(source.docName)}</span>
                                  <span className="source-name">{source.docName}</span>
                                  {source.heading !== '正文' && (
                                    <span className="source-heading">· {source.heading}</span>
                                  )}
                                  <span className="source-score">相关度 {formatScore(source.score)}</span>
                                </div>
                                <p className="source-text">{source.text}</p>
                              </li>
                            ))}
                          </ul>
                        </SourcesContent>
                      </Sources>
                    )}
                  </Message>
                )
              })
            )}
            {status === 'submitted' && <p className="typing-hint">检索相关片段中…</p>}
          </ConversationContent>
          {messages.length > 0 && <ConversationScrollButton />}
        </Conversation>

        {error && (
          <div className="alert chat-error" role="alert">
            <ul>
              <li>生成失败：{error.message}</li>
            </ul>
          </div>
        )}

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
        >
          {/* Vercel 式输入框：外层圆角容器包住输入区与底部操作行，
              按钮嵌在容器内，避免与多行输入框比高度 */}
          <div className="composer-box">
            <textarea
              className="composer-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder="输入问题"
              aria-label="输入问题"
            />
            <div className="composer-bar">
              <span className="composer-hint">
                {status === 'submitted' ? '检索相关片段中…' : 'Enter 发送 · Shift + Enter 换行'}
              </span>
              {status === 'streaming' ? (
                <button type="button" className="send" onClick={stop}>
                  停止
                </button>
              ) : (
                <button type="submit" className="send" disabled={!draft.trim() || busy}>
                  发送
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
    </>
  )
}

export default ChatPage
