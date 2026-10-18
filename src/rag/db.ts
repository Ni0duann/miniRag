import type { Doc } from '../types'
import type { IndexSummary, RawChunk, VectorRecord } from './types'

const DB_NAME = 'minirag'
const DB_VERSION = 2
const DOC_STORE = 'docs'
const CHUNK_STORE = 'chunks'
const VECTOR_STORE = 'vectors'

let openPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!openPromise) {
    openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        // v1 只建 docs；v2 补 chunks/vectors（Step 3 embedding 的落库目标）
        const db = request.result
        if (!db.objectStoreNames.contains(DOC_STORE)) {
          db.createObjectStore(DOC_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          const chunks = db.createObjectStore(CHUNK_STORE, { keyPath: 'id' })
          // 删除文档时要按 docId 反查它的所有块
          chunks.createIndex('docId', 'docId')
        }
        if (!db.objectStoreNames.contains(VECTOR_STORE)) {
          const vectors = db.createObjectStore(VECTOR_STORE, { keyPath: 'id' })
          vectors.createIndex('docId', 'docId')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'))
      // 其他标签页持有旧版本连接时会永久 blocked，直接失败让上层降级
      request.onblocked = () => reject(new Error('IndexedDB 被其他页面连接阻塞'))
    }).catch((error) => {
      // 失败的 Promise 不能缓存，否则一次抖动会让后续所有操作都报错
      openPromise = null
      throw error
    })
  }
  return openPromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    // put() 单条不报错不代表落盘成功，以事务 complete 为准
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中断'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
  })
}

export async function loadDocs(): Promise<Doc[]> {
  const db = await openDb()
  const docs = await requestResult(db.transaction(DOC_STORE, 'readonly').objectStore(DOC_STORE).getAll())
  // 主键是随机 UUID，游标只按字典序遍历，列表顺序必须靠 createdAt 还原
  return (docs as Doc[]).sort((a, b) => b.createdAt - a.createdAt)
}

export async function putDocs(docs: Doc[]): Promise<void> {
  if (docs.length === 0) return
  const db = await openDb()
  const tx = db.transaction(DOC_STORE, 'readwrite')
  const store = tx.objectStore(DOC_STORE)
  docs.forEach((doc) => store.put(doc))
  await transactionDone(tx)
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(DOC_STORE, 'readwrite')
  tx.objectStore(DOC_STORE).delete(id)
  await transactionDone(tx)
}

export async function clearDocs(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(DOC_STORE, 'readwrite')
  tx.objectStore(DOC_STORE).clear()
  await transactionDone(tx)
}

export async function putChunks(chunks: RawChunk[]): Promise<void> {
  if (chunks.length === 0) return
  const db = await openDb()
  const tx = db.transaction(CHUNK_STORE, 'readwrite')
  const store = tx.objectStore(CHUNK_STORE)
  chunks.forEach((chunk) => store.put(chunk))
  await transactionDone(tx)
}

export async function putVectors(vectors: VectorRecord[]): Promise<void> {
  if (vectors.length === 0) return
  const db = await openDb()
  const tx = db.transaction(VECTOR_STORE, 'readwrite')
  const store = tx.objectStore(VECTOR_STORE)
  vectors.forEach((record) => store.put(record))
  await transactionDone(tx)
}

/** 删除一篇文档的全部块与向量；两者放同一事务，避免出现「有块无向量」的半删状态 */
export async function deleteDocIndex(docId: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([CHUNK_STORE, VECTOR_STORE], 'readwrite')
  for (const name of [CHUNK_STORE, VECTOR_STORE]) {
    const index = tx.objectStore(name).index('docId')
    const keys = await requestResult(index.getAllKeys(IDBKeyRange.only(docId)))
    const store = tx.objectStore(name)
    keys.forEach((key) => store.delete(key))
  }
  await transactionDone(tx)
}

export async function clearDocIndex(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([CHUNK_STORE, VECTOR_STORE], 'readwrite')
  tx.objectStore(CHUNK_STORE).clear()
  tx.objectStore(VECTOR_STORE).clear()
  await transactionDone(tx)
}

/**
 * 汇总每篇文档的索引覆盖情况。
 * 学习规模（千级块）直接 getAll 计数即可；真到万级再换成索引 count 查询。
 */
export async function loadIndexSummary(): Promise<IndexSummary> {
  const db = await openDb()
  const tx = db.transaction([CHUNK_STORE, VECTOR_STORE], 'readonly')
  const [chunks, vectors] = await Promise.all([
    requestResult(tx.objectStore(CHUNK_STORE).getAll()),
    requestResult(tx.objectStore(VECTOR_STORE).getAll()),
  ])
  const summary: IndexSummary = {}
  for (const chunk of chunks as RawChunk[]) {
    summary[chunk.docId] ??= { chunks: 0, vectors: 0 }
    summary[chunk.docId].chunks += 1
  }
  for (const record of vectors as VectorRecord[]) {
    summary[record.docId] ??= { chunks: 0, vectors: 0 }
    summary[record.docId].vectors += 1
  }
  return summary
}
