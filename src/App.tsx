import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import UploadPage from './pages/UploadPage'
import { loadDocs } from './rag/db'
import type { ChatMessage, Doc } from './types'
import './App.css'

function App() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // 隐私模式或旧浏览器可能打不开 IndexedDB，此时降级为纯内存并明确告知
  const [storageWarning, setStorageWarning] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDocs()
      .then((restored) => {
        if (cancelled) return
        // prev 优先合并：恢复完成前用户已上传的文档不被覆盖
        setDocs((prev) => {
          const ids = new Set(prev.map((doc) => doc.id))
          return [...prev, ...restored.filter((doc) => !ids.has(doc.id))]
        })
      })
      .catch((error) => {
        if (cancelled) return
        const reason = error instanceof Error ? error.message : '未知错误'
        setStorageWarning(`本地存储打开失败（${reason}），文档仅保存在内存中，刷新后会丢失。`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-dot" />
          miniRAG
        </NavLink>
        <nav className="nav" aria-label="主导航">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            文档
          </NavLink>
          <NavLink to="/chat" className={({ isActive }) => (isActive ? 'active' : '')}>
            问答
          </NavLink>
        </nav>
      </header>

      {storageWarning && (
        <div className="alert storage-alert" role="alert">
          <ul>
            <li>{storageWarning}</li>
          </ul>
          <button
            type="button"
            className="alert-close"
            onClick={() => setStorageWarning(null)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}

      <Routes>
        <Route index element={<UploadPage docs={docs} setDocs={setDocs} />} />
        <Route
          path="/chat"
          element={<ChatPage docs={docs} messages={messages} setMessages={setMessages} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <footer className="foot">
        文件解析、Embedding 与检索均在浏览器本地完成；配置生成模型后，仅问题与命中片段会直连你配置的 API。
      </footer>
    </div>
  )
}

export default App
