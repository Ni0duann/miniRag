import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { retrieve } from '../retrieval'
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

function ChatPage({ docs, messages, setMessages }: Props) {
  const [draft, setDraft] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [messages])

  function send() {
    const question = draft.trim()
    if (!question) return

    const results = retrieve(docs, question)
    let answer: string
    if (docs.length === 0) {
      answer = '还没有可检索的文档，请先在「文档」页上传 Markdown 文件。'
    } else if (results.length === 0) {
      answer = '没有在已上传的文档中找到相关内容，试试换个关键词。'
    } else {
      answer = `在已上传的文档中检索到 ${results.length} 个相关片段：`
    }

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text: question },
      { id: crypto.randomUUID(), role: 'assistant', text: answer, sources: results },
    ])
    setDraft('')
  }

  return (
    <>
      <div className="header">
        <h1>知识问答</h1>
        <p className="subtitle">
          {docs.length > 0
            ? `已加载 ${docs.length} 篇文档 · 本地关键词检索，暂未接入生成模型。`
            : '基于已上传文档的本地关键词检索，暂未接入生成模型。'}
        </p>
      </div>

      <section className="panel chat-panel">
        <div className="chat-body" ref={bodyRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <span className="preview-icon">
                <ChatIcon />
              </span>
              <p>输入问题，我会从已上传的 Markdown 文档中查找相关片段。</p>
              {docs.length === 0 && (
                <Link to="/" className="link-btn">
                  先上传文档
                </Link>
              )}
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`chat-msg ${message.role}`}>
                <div className="bubble">{message.text}</div>
                {message.sources && message.sources.length > 0 && (
                  <ul className="sources">
                    {message.sources.map((source) => (
                      <li key={source.id} className="source">
                        <div className="source-head">
                          <span className="md-badge">MD</span>
                          <span className="source-name">{source.docName}</span>
                          {source.heading !== '正文' && (
                            <span className="source-heading">· {source.heading}</span>
                          )}
                          <span className="source-score">相关度 {source.score}</span>
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
            send()
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder="输入问题，Enter 发送，Shift + Enter 换行"
            aria-label="输入问题"
          />
          <button type="submit" className="send" disabled={!draft.trim()}>
            发送
          </button>
        </form>
      </section>
    </>
  )
}

export default ChatPage
