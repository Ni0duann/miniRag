import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// GitHub Pages 项目站点部署在 /<仓库名>/ 子路径下，资源前缀必须跟着变
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  base: repository ? `/${repository}/` : '/',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
})
