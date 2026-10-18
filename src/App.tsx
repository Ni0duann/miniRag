import { useState } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import UploadPage from './pages/UploadPage'
import type { ChatMessage, Doc } from './types'
import './App.css'

function App() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])

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

      <Routes>
        <Route index element={<UploadPage docs={docs} setDocs={setDocs} />} />
        <Route
          path="/chat"
          element={<ChatPage docs={docs} messages={messages} setMessages={setMessages} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <footer className="foot">文件解析与检索均在浏览器本地完成，不会发送到服务器。</footer>
    </div>
  )
}

export default App
