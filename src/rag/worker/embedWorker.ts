/// <reference lib="webworker" />
// Embedding Worker：在后台线程加载 bge-small-zh-v1.5（q8 量化）并批量编码文本。
// 推理放 Worker 是为了不阻塞 UI；模型单例常驻，页面存活期间只加载一次。
import { env, pipeline } from '@huggingface/transformers'

const ctx = self as unknown as DedicatedWorkerGlobalScope

const MODEL_NAME = 'Xenova/bge-small-zh-v1.5'
// 64 条/批：太小浪费 WebGPU 并行，太大内存吃紧且进度回报不流畅
const BATCH_SIZE = 64
const MAX_RETRIES = 3

// 模型托管方式：ONNX 权重放在 public/models/（`pnpm model:get` 下载），
// 浏览器同源加载，彻底绕开 CORS 与国内访问 huggingface.co 不通的问题；
// CI 构建前同样跑 model:get，部署产物自带模型文件。
env.allowLocalModels = true
// BASE_URL 保证 GitHub Pages 子路径部署时本地模型路径也带上前缀
env.localModelPath = `${import.meta.env.BASE_URL}models/`
// 兜底：本地文件缺失时仍可远程拉取。国内网络下 huggingface.co 可能不通，
// 可在控制台 localStorage.setItem('minirag.modelHost', 'https://可CORS的镜像') 换源
env.allowRemoteModels = true
try {
  const override = localStorage.getItem('minirag.modelHost')
  if (override) env.remoteHost = override
} catch {
  // 拿不到 localStorage 就用默认 remoteHost
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>

let extractorPromise: Promise<FeatureExtractor> | null = null

async function loadExtractor(): Promise<FeatureExtractor> {
  const base = { dtype: 'q8' as const }
  try {
    // WebGPU 优先；不受支持（旧浏览器/无独显）时回退 WASM，速度慢 3~5 倍但仍可用
    const extractor = await pipeline('feature-extraction', MODEL_NAME, { ...base, device: 'webgpu' })
    return extractor as unknown as FeatureExtractor
  } catch {
    const extractor = await pipeline('feature-extraction', MODEL_NAME, base)
    return extractor as unknown as FeatureExtractor
  }
}

function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = loadExtractor().catch((error) => {
      // 加载失败（断网等）不能缓存坏 Promise，否则重试永远失败
      extractorPromise = null
      throw error
    })
  }
  return extractorPromise
}

async function encodeBatch(extractor: FeatureExtractor, texts: string[]): Promise<Float32Array[]> {
  // bge 是 CLS 池化模型：取 [CLS] 向量并做 L2 归一化（归一化后余弦相似度 = 点积）
  const output = await extractor(texts, { pooling: 'cls', normalize: true })
  const dim = output.data.length / texts.length
  const vectors: Float32Array[] = []
  for (let i = 0; i < texts.length; i += 1) {
    vectors.push(output.data.slice(i * dim, (i + 1) * dim))
  }
  return vectors
}

async function handleRequest(id: number, texts: string[]): Promise<void> {
  ctx.postMessage({ type: 'phase', id, phase: 'loading' })
  let extractor: FeatureExtractor
  try {
    extractor = await getExtractor()
  } catch (error) {
    // 最常见的失败原因是模型文件没下载，直接给出操作指引
    const reason = error instanceof Error ? error.message : '未知错误'
    throw new Error(`模型加载失败（${reason}）。请先执行 pnpm model:get 下载模型到 public/models/`)
  }
  ctx.postMessage({ type: 'phase', id, phase: 'embedding' })

  const total = texts.length
  const vectors: Float32Array[] = []
  for (let start = 0; start < total; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE)
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        vectors.push(...(await encodeBatch(extractor, batch)))
        lastError = null
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) {
      throw new Error(`第 ${vectors.length + 1}~${Math.min(start + BATCH_SIZE, total)} 条编码失败：${
        lastError instanceof Error ? lastError.message : '未知错误'
      }`)
    }
    ctx.postMessage({ type: 'progress', id, done: vectors.length, total })
  }

  // 转移 ArrayBuffer 所有权，避免复制几十 MB 向量回主线程
  ctx.postMessage({ type: 'result', id, vectors }, vectors.map((v) => v.buffer))
}

ctx.onmessage = (event: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = event.data
  if (texts.length === 0) {
    ctx.postMessage({ type: 'result', id, vectors: [] })
    return
  }
  handleRequest(id, texts).catch((error) => {
    ctx.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : 'Embedding 失败',
    })
  })
}
