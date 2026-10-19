import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// Tailwind/shadcn 的暗色靠 html.dark class，旧页面靠 prefers-color-scheme；
// 这里跟随系统偏好补上 class，让两套主题机制行为一致
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
const syncDarkClass = () => document.documentElement.classList.toggle('dark', darkMedia.matches)
syncDarkClass()
darkMedia.addEventListener('change', syncDarkClass)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
