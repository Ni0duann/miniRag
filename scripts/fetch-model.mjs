// 把 bge-small-zh-v1.5 的 ONNX 权重从镜像站下载到 public/models/，
// 让浏览器走同源加载（transformers.js 跨域受 CORS 限制，国内访问 HF 还经常不通）。
// 用法：pnpm model:get（dev 与 CI 构建前都要跑一次；产物目录不提交 git）
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

const MODEL_ID = 'Xenova/bge-small-zh-v1.5'
const BASE = process.env.MODEL_BASE ?? 'https://hf-mirror.com'
const OUT_ROOT = join('public', 'models', MODEL_ID)

const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  'onnx/model_quantized.onnx',
]

async function download(relativePath) {
  const url = `${BASE}/${MODEL_ID}/resolve/main/${relativePath}`
  const target = join(OUT_ROOT, ...relativePath.split('/'))
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} -> HTTP ${response.status}`)
  mkdirSync(dirname(target), { recursive: true })
  await pipeline(response.body, createWriteStream(target))
  console.log(`  ✓ ${relativePath}`)
}

console.log(`下载 ${MODEL_ID}（源：${BASE}）→ ${OUT_ROOT}`)
for (const file of FILES) await download(file)
console.log('完成。现在浏览器端会从本地 public/models/ 加载模型。')
