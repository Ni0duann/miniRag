// 主线程与 Embedding Worker 的唯一交互入口。
// Worker 内部是异步消息处理，多条并发请求的进度会互相穿插，
// 所以这里用队列保证「一次只有一个请求在 Worker 里跑」。

export type EmbedPhase = 'loading' | 'embedding'

export type EmbedProgress = {
  phase: EmbedPhase
  done: number
  total: number
}

type PendingRequest = {
  resolve: (vectors: Float32Array[]) => void
  reject: (error: Error) => void
  onProgress?: (progress: EmbedProgress) => void
}

type WorkerOutMessage =
  | { type: 'phase'; id: number; phase: EmbedPhase }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; vectors: Float32Array[] }
  | { type: 'error'; id: number; message: string }

// bge 系列是非对称检索模型：官方建议查询端加指令前缀，文档端不加，
// 否则查询召回质量明显下降。Step 4 的向量检索会用到 embedQuery。
const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：'

let worker: Worker | null = null
let seq = 0
let currentId = -1
const pending = new Map<number, PendingRequest>()
const queue: { id: number; texts: string[] }[] = []
let running = false

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker/embedWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const message = event.data
      const request = pending.get(message.id)
      if (!request) return

      switch (message.type) {
        case 'phase':
          request.onProgress?.({ phase: message.phase, done: 0, total: 0 })
          break
        case 'progress':
          request.onProgress?.({ phase: 'embedding', done: message.done, total: message.total })
          break
        case 'result':
          pending.delete(message.id)
          request.resolve(message.vectors)
          runNext()
          break
        case 'error':
          pending.delete(message.id)
          request.reject(new Error(message.message))
          runNext()
          break
      }
    }
    worker.onerror = (event) => {
      // Worker 崩溃（脚本加载失败等）时把所有在途请求判负，避免调用方永久挂起
      const request = running ? pending.get(currentId) : undefined
      currentId = -1
      running = false
      request?.reject(new Error(event.message || 'Embedding Worker 异常'))
      runNext()
    }
  }
  return worker
}

function runNext(): void {
  const next = queue.shift()
  if (!next) {
    running = false
    currentId = -1
    return
  }
  running = true
  currentId = next.id
  getWorker().postMessage({ id: next.id, texts: next.texts })
}

/** 批量编码文本，返回与输入等长的向量列表；onProgress 回报加载/编码进度 */
export function embedTexts(
  texts: string[],
  onProgress?: (progress: EmbedProgress) => void,
): Promise<Float32Array[]> {
  if (texts.length === 0) return Promise.resolve([])
  const id = ++seq
  return new Promise<Float32Array[]>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    queue.push({ id, texts })
    if (!running) runNext()
  })
}

/** 单条查询编码（自动加 bge 检索指令前缀），供 Step 4 向量检索使用 */
export async function embedQuery(question: string): Promise<Float32Array> {
  const [vector] = await embedTexts([`${QUERY_PREFIX}${question}`])
  return vector
}
