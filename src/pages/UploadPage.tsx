import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { formatSize, isMarkdown, MAX_FILE_SIZE } from '../docs'
import type { Doc } from '../types'

type Props = {
  docs: Doc[]
  setDocs: Dispatch<SetStateAction<Doc[]>>
}

function UploadIcon() {
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
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

function DocIcon() {
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
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  )
}

function UploadPage({ docs, setDocs }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedDoc = docs.find((doc) => doc.id === selectedId) ?? null
  const totalChars = docs.reduce((sum, doc) => sum + doc.content.length, 0)

  async function addFiles(files: File[]) {
    if (files.length === 0) return

    const problems: string[] = []
    const additions: Doc[] = []

    for (const file of files) {
      if (!isMarkdown(file.name)) {
        problems.push(`${file.name}：仅支持 .md / .markdown 文件`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        problems.push(`${file.name}：文件超过 5 MB`)
        continue
      }

      const content = await file.text()
      if (!content.trim()) {
        problems.push(`${file.name}：文件内容为空`)
        continue
      }

      const duplicated =
        docs.some((doc) => doc.name === file.name && doc.size === file.size) ||
        additions.some((doc) => doc.name === file.name && doc.size === file.size)
      if (duplicated) {
        problems.push(`${file.name}：已在文档列表中`)
        continue
      }

      additions.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        content,
      })
    }

    setErrors(problems)
    if (additions.length > 0) {
      setDocs((prev) => [...additions, ...prev])
      setSelectedId((current) => current ?? additions[0].id)
    }
  }

  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((doc) => doc.id !== id))
    if (selectedId === id) {
      const next = docs.find((doc) => doc.id !== id) ?? null
      setSelectedId(next?.id ?? null)
    }
  }

  function clearAll() {
    setDocs([])
    setSelectedId(null)
    setErrors([])
  }

  return (
    <>
      <div className="header">
        <h1>上传 Markdown 文档</h1>
        <p className="subtitle">支持拖拽或点击选择，上传后可直接预览 Markdown 原文。</p>
      </div>

      <main className="layout">
        <section className="panel">
          <button
            type="button"
            className={`dropzone${isDragging ? ' is-dragging' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setIsDragging(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragging(false)
              void addFiles(Array.from(event.dataTransfer.files))
            }}
          >
            <span className="dropzone-icon">
              <UploadIcon />
            </span>
            <span className="dropzone-title">
              {isDragging ? '松开即可添加文件' : '拖拽 .md 文件到这里'}
            </span>
            <span className="dropzone-hint">或点击选择文件 · 支持 .md / .markdown，可多选</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.markdown,text/markdown"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void addFiles(files)
            }}
          />

          {errors.length > 0 && (
            <div className="alert" role="alert">
              <ul>
                {errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
              <button
                type="button"
                className="alert-close"
                onClick={() => setErrors([])}
                aria-label="关闭提示"
              >
                ×
              </button>
            </div>
          )}

          <div className="list-head">
            <h2>
              文档列表
              <span className="count">{docs.length}</span>
            </h2>
            {docs.length > 0 && (
              <button type="button" className="ghost" onClick={clearAll}>
                清空
              </button>
            )}
          </div>

          {docs.length === 0 ? (
            <p className="empty">还没有上传文档</p>
          ) : (
            <ul className="doc-list">
              {docs.map((doc) => (
                <li key={doc.id} className={doc.id === selectedId ? 'selected' : ''}>
                  <button
                    type="button"
                    className="doc-main"
                    onClick={() => setSelectedId(doc.id)}
                    title={doc.name}
                  >
                    <span className="md-badge">MD</span>
                    <span className="doc-info">
                      <span className="doc-name">{doc.name}</span>
                      <span className="doc-meta">
                        {formatSize(doc.size)} · {doc.content.length.toLocaleString()} 字符
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="remove"
                    onClick={() => removeDoc(doc.id)}
                    aria-label={`移除 ${doc.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {docs.length > 0 && (
            <p className="stats">
              共 {docs.length} 篇 · {totalChars.toLocaleString()} 字符
            </p>
          )}
        </section>

        <section className="panel preview-panel">
          {selectedDoc ? (
            <>
              <div className="preview-head">
                <h2 title={selectedDoc.name}>{selectedDoc.name}</h2>
                <span className="doc-meta">
                  {formatSize(selectedDoc.size)} · {selectedDoc.content.length.toLocaleString()}{' '}
                  字符
                </span>
              </div>
              <pre className="preview-body">{selectedDoc.content}</pre>
            </>
          ) : (
            <div className="preview-empty">
              <span className="preview-icon">
                <DocIcon />
              </span>
              <p>选择左侧文档，在这里查看原文</p>
            </div>
          )}
        </section>
      </main>
    </>
  )
}

export default UploadPage
