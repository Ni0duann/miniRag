import type { Doc } from '../types'

const DB_NAME = 'minirag'
const DB_VERSION = 1
const DOC_STORE = 'docs'

let openPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!openPromise) {
    openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        // v1 只建 docs；Step 2/3 需要 chunks/vectors 时通过版本号升级添加 store
        if (!request.result.objectStoreNames.contains(DOC_STORE)) {
          request.result.createObjectStore(DOC_STORE, { keyPath: 'id' })
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
