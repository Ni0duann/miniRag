export const MAX_FILE_SIZE = 5 * 1024 * 1024

export function isSupportedDoc(name: string) {
  return /\.(md|markdown|txt|text|pdf)$/i.test(name)
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 列表与来源卡片统一用的类型徽标 */
export function fileBadge(name: string) {
  return /\.pdf$/i.test(name) ? 'PDF' : 'DOC'
}
