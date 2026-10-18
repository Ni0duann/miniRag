export const MAX_FILE_SIZE = 5 * 1024 * 1024

export function isMarkdown(name: string) {
  return /\.(md|markdown)$/i.test(name)
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
