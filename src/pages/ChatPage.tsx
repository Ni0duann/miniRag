import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { hybridSearch } from '../rag/search'
import { buildMessages, loadLlmConfig, saveLlmConfig, streamAnswer, type LlmConfig } from '../rag/answer'
import { fileBadge } from '../docs'
import type { ChatMessage, Doc } from '../types'

type Props = {
  docs: Doc[]
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
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

// DeepSeek 官方 OpenAI 兼容端点；V4 系列 API 调用名为 deepseek-v4-flash（旧名 deepseek-chat 已停用）
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-v4-flash'

function ChatPage({ docs, messages, setMessages }: Props) {
  const [draft, setDraft] = useState('')
  const [searching, setSearching] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [config, setConfig] = useState<LlmConfig | null>(() => loadLlmConfig())
  const [showSettings, setShowSettings] = useState(false)
  const [baseUrl, setBaseUrl] = useState(() => loadLlmConfig()?.baseUrl ?? DEFAULT_BASE_URL)
  const [apiKey, setApiKey] = useState(() => loadLlmConfig()?.apiKey ?? '')
  const [model, setModel] = useState(() => loadLlmConfig()?.model ?? DEFAULT_MODEL)
  const bodyRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [messages])

  function appendToMessage(id: string, text: string) {
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? { ...message, text: message.text + text } : message)),
    )
  }

  async function send() {
    const question = draft.trim()
    if (!question || searching || generating) return

    setDraft('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: question }])
    setSearching(true)

    let retrievalAnswer = ''
    let sources: ChatMessage['sources']
    try {
      if (docs.length === 0) {
        retrievalAnswer = '还没有可检索的文档，请先在「文档」页上传文件。'
      } else {
        const outcome = await hybridSearch(docs, question)
        sources = outcome.results
        if (outcome.results.length === 0) {
          retrievalAnswer = '没有在已上传的文档中找到相关内容，试试换个关键词。'
        } else if (!config) {
          // 未配置模型时保持仅检索模式（Step 4 行为），并引导去设置
          retrievalAnswer =
            `检索到 ${outcome.results.length} 个相关片段（${outcome.mode === 'hybrid' ? '混合检索' : '关键词检索'}）。` +
            `${outcome.mode === 'keyword' ? (outcome.reason ?? '') : ''}配置生成模型后，我会基于这些片段流式回答问题。`
        }
      }
    } finally {
      setSearching(false)
    }

    if (retrievalAnswer || !sources || sources.length === 0 || !config) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: retrievalAnswer, sources },
      ])
      return
    }

    // 检索命中且已配置模型：先落一条空的 assistant 消息，边收 delta 边填
    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', text: '', sources },
    ])
    setGenerating(true)
    const controller = new AbortController()
    abortRef.current = controller

    await streamAnswer(
      config,
      buildMessages(question, sources),
      {
        onDelta: (delta) => appendToMessage(assistantId, delta),
        onDone: () => setGenerating(false),
        onError: (error) => {
          appendToMessage(assistantId, `\n\n（生成失败：${error.message}）`)
          setGenerating(false)
        },
      },
      controller.signal,
    )
  }

  function stop() {
    abortRef.current?.abort()
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
          <button type="button" className="ghost" onClick={() => setShowSettings((prev) => !prev)}>
            模型设置{config ? ' · 已配置' : ''}
          </button>
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
              <button type="button" className="link-btn" onClick={saveSettings} disabled={!baseUrl.trim() || !apiKey.trim() || !model.trim()}>
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
        <div className="chat-body" ref={bodyRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <span className="preview-icon">
                <ChatIcon />
              </span>
              <p>输入问题，我会从已上传的文档中查找相关片段并生成回答。</p>
              {docs.length === 0 && (
                <Link to="/" className="link-btn">
                  先上传文档
                </Link>
              )}
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`chat-msg ${message.role}`}>
                <div className="bubble">
                  {message.text}
                  {generating && message.role === 'assistant' && message.id === lastAssistantId(messages) && (
                    <span className="cursor" aria-hidden="true" />
                  )}
                </div>
                {message.sources && message.sources.length > 0 && (
                  <ul className="sources">
                    {message.sources.map((source, index) => (
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
                )}
              </div>
            ))
          )}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder={
              searching ? '检索中，请稍候…' : '输入问题，Enter 发送，Shift + Enter 换行'
            }
            aria-label="输入问题"
          />
          {generating ? (
            <button type="button" className="send" onClick={stop}>
              停止
            </button>
          ) : (
            <button type="submit" className="send" disabled={!draft.trim() || searching}>
              {searching ? '检索中…' : '发送'}
            </button>
          )}
        </form>
      </section>
    </>
  )
}

function lastAssistantId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') return messages[i].id
  }
  return undefined
}

export default ChatPage
