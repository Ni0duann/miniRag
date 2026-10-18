// 文件解析：把上传的 File 转成纯文本，供后续切块（chunk.ts / split.ts）使用。
// 文本类（.md/.markdown/.txt）同步读取即可；PDF 走 pdf.js，且整个库懒加载，
// 只有真正解析 PDF 时才把 ~1MB 的 worker 和解析代码拉进页面，不拖累首屏。

export type FileKind = 'markdown' | 'text' | 'pdf'

const EXT_KIND: Record<string, FileKind> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  text: 'text',
  pdf: 'pdf',
}

/** 按扩展名识别文件类型；不识别的返回 null，由调用方决定报错文案 */
export function detectFileKind(name: string): FileKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  return ext ? EXT_KIND[ext] ?? null : null
}

/**
 * 读取文本文件内容。
 * 先按 UTF-8 严格解码（fatal 模式下非法字节会抛错），失败再按 GBK 回退——
 * 中文环境里的 .txt 很可能是 GBK 编码，直接读会乱码。
 */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gbk').decode(buf)
  }
}

// pdf.js 的渲染器与 worker 是两条独立通道，GlobalWorkerOptions 等全局配置
// 必须等模块加载完成后设置，所以用 Promise 缓存加载结果，并发调用共享一次加载
let pdfjsLoader: Promise<typeof import('pdfjs-dist')> | null = null

async function loadPdfjs() {
  if (!pdfjsLoader) {
    pdfjsLoader = (async () => {
      const pdfjs = await import('pdfjs-dist')
      // 只设 workerPort（Vite 按模块 URL 打包 worker）；再设 workerSrc 会让
      // Vite 额外打一份 classic 副本，白白多 1MB
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
        { type: 'module' },
      )
      return pdfjs
    })().catch((error) => {
      // 加载失败时清空缓存，允许下次上传重试
      pdfjsLoader = null
      throw error
    })
  }
  return pdfjsLoader
}

/**
 * 提取 PDF 全文。
 * pdf.js 返回的是带坐标的文字片段（items），没有现成的行/段结构，
 * 这里按 y 坐标聚类还原文：y 差在一行高度以内算同一行，行内按 x 排序拼接，
 * 行间距明显大于行高时插入空行，尽量保住段落边界（切块器依赖空行分段）。
 */
async function extractPdfText(data: ArrayBuffer, onProgress?: (page: number, total: number) => void): Promise<string> {
  const pdfjs = await loadPdfjs()
  // cmaps（中文 CID 字体映射）与标准字体在 postinstall 拷到 public/，
  // 按 BASE_URL 拼接以兼容 GitHub Pages 子路径部署
  const asset = (dir: string) => `${import.meta.env.BASE_URL}${dir}/`
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
  }).promise

  const pages: string[] = []
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      onProgress?.(pageNo, doc.numPages)
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()

      type Line = { y: number; parts: { x: number; str: string }[] }
      const lines: Line[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5]
        // 行高容差：item.height 为 0（空片段）时给 12pt 兜底
        const tolerance = Math.max(item.height, 12) * 0.6
        const line = lines.find((l) => Math.abs(l.y - y) <= tolerance)
        if (line) line.parts.push({ x: item.transform[4], str: item.str })
        else lines.push({ y, parts: [{ x: item.transform[4], str: item.str }] })
      }

      // PDF 坐标原点在左下，y 越大越靠上 → 降序还原阅读顺序。
      // 相邻两行间距明显超过正常行距时插空行，还原段落边界
      const ordered = lines.sort((a, b) => b.y - a.y)
      const texts: string[] = []
      // PDF 行距没有元数据，用 14pt 作为典型正文行高的近似值
      const LINE_HEIGHT = 14
      for (let i = 0; i < ordered.length; i += 1) {
        if (i > 0 && ordered[i - 1].y - ordered[i].y > LINE_HEIGHT * 1.7) texts.push('')
        texts.push(ordered[i].parts.sort((p, q) => p.x - q.x).map((p) => p.str).join(''))
      }
      pages.push(texts.join('\n'))
    }
  } finally {
    // 大 PDF 的临时对象挂在内存缓存里，解析完通过 loadingTask 主动释放
    void doc.loadingTask.destroy()
  }

  return pages.join('\n\n')
}

export type ParsedFile = {
  kind: FileKind
  content: string
}

/** 解析入口：按文件类型分发，返回纯文本内容 */
export async function parseFile(
  file: File,
  onPdfProgress?: (page: number, total: number) => void
): Promise<ParsedFile> {
  const kind = detectFileKind(file.name)
  if (!kind) throw new Error(`不支持的文件类型：${file.name}`)

  if (kind === 'pdf') {
    const content = await extractPdfText(await file.arrayBuffer(), onPdfProgress)
    if (!content.trim()) throw new Error(`${file.name}：未能从 PDF 中提取到文本（可能是纯扫描图片版）`)
    return { kind, content }
  }

  return { kind, content: await readText(file) }
}
