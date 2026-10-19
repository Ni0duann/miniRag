import { fileURLToPath } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// GitHub Pages 项目站点部署在 /<仓库名>/ 子路径下，资源前缀必须跟着变
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  base: repository ? `/${repository}/` : '/',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  // shadcn/AI Elements 组件按 '@/lib/utils' 风格引用，构建与 TS paths 保持一致
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
