# 浏览器内 RAG 实现计划（无后端）

## 目标

不依赖 Node 服务，把 RAG 全流程跑在浏览器里：文档解析、切块、本地 Embedding（ONNX/WebGPU）、向量检索、LLM 生成。LLM 走云端 API，其余全部在客户端完成。代码放在 `src/rag/`，复用现有 React 页面。

现状：`ChatPage.tsx` 直接调 `src/retrieval.ts` 的 bigram 关键词检索，文档只存在内存（刷新即丢），无生成模型。

## 技术选型

| 环节 | 方案 | 理由 |
|------|------|------|
| Embedding 推理 | `@huggingface/transformers`（transformers.js v4） | 浏览器跑 ONNX 小模型 `Xenova/bge-small-zh-v1.5`（q8 约 24MB，支持中文）；权重经 `pnpm model:get` 放 `public/models/` 同源加载，规避 CORS |
| 执行后端 | WebGPU 优先，回退 WASM；推理放 Web Worker | 不阻塞 UI；模型文件走 CDN + Cache API 缓存 |
| 向量存储与检索 | Float32 向量存 IndexedDB；检索时加载内存做余弦相似度 | 千级块暴力计算足够快（<50ms），先不引入 HNSW |
| 持久化 | IndexedDB（`docs`/`chunks`/`vectors` 三个 object store） | 刷新后文档不丢；单库可存几百 MB |
| 关键词兜底 | 保留现有 bigram 打分，与向量结果做 RRF 融合 | 零额外依赖，混合检索提升召回 |
| LLM 生成 | 浏览器直调 OpenAI 兼容 API（DashScope/DeepSeek），SSE 流式 | 无后端；Key 存 localStorage，仅限本地学习用途 |
| PDF 解析 | `pdfjs-dist`（按需懒加载） | 现仅支持 md/txt，扩展到 pdf |

## 总体流程

```
上传文件(File 对象)
   │
   ▼
解析文本(md/txt 直接读；pdf 用 pdf.js)
   │
   ▼
切块(沿用现有标题感知策略 + 块间重叠)
   │
   ▼
Worker 内批量 Embedding(transformers.js, 64条/批)
   │
   ▼
IndexedDB 落库(docs / chunks / vectors)
   
提问
   │
   ▼
查询 Embedding(同模型，Worker 常驻热缓存)
   │
   ├─► 向量 Top-10(内存余弦)
   └─► bigram 关键词 Top-10(现有逻辑)
          │
          ▼
     RRF 融合取 Top-3~5
          │
          ▼
组装 Prompt(上下文编号 [1][2]… + 系统指令)
          │
          ▼
fetch 云端 LLM(SSE 流式) → 逐 token 渲染 + 引用卡片
```

## 目录结构

```
src/rag/
├── types.ts            # Chunk / VectorRecord / RagConfig 类型
├── db.ts               # IndexedDB 封装(open/putDocs/queryVectors)
├── chunk.ts            # 切块(迁移 retrieval.ts 的 chunkDocument，加重叠)
├── ingest.ts           # 入库管线: parse -> chunk -> embed -> persist
├── parse.ts            # 文件读取: text/markdown/pdf(懒加载 pdfjs)
├── search.ts           # 向量余弦 + bigram 关键词 + RRF 融合
├── answer.ts           # Prompt 组装 + fetch LLM + SSE 解析
└── worker/
    └── embedWorker.ts  # Web Worker: 加载模型、批量 encode、进度回报
```

页面改动：
- `App.tsx`：docs 状态改为从 IndexedDB 初始化，上传/删除走 `ingest.ts`
- `UploadPage.tsx`：上传后展示切块数与 embedding 进度条
- `ChatPage.tsx`：`retrieve()` 换成 `search()` + `answer()`，流式渲染答案与引用

## 关键设计点

1. **模型加载**：首次下载 ~100MB 后由浏览器 HTTP 缓存持有；Worker 内单例持有 pipeline，空闲不卸载，页面刷新后重新 load（命中缓存，秒级）。
2. **Embedding 批量与失败重试**：64 条/批，批间向 UI 回报进度（`onprogress`）；单批失败重试 3 次；全部成功才写 vectors，否则该文档标记「未完成索引」可重试。
3. **向量序列化**：Float32Array ↔ ArrayBuffer 直接存 IndexedDB，读取零解析成本；bge-small 维度 512，1000 块约 2MB。
4. **混合检索**：向量分数归一化后与 bigram 结果按 RRF(k=60) 融合，Top-K 默认 5；查询 embedding 失败时自动降级为纯关键词（保持现有行为）。
5. **引用一致性**：Prompt 中每段上下文带 `[n]`，LLM 回答须引用编号；前端把编号映射回 `{docName, heading}` 渲染来源卡片——复用现有 `RetrievedChunk` 类型。
6. **CORS 与 Key**：transformers.js 模型源（HF CDN / hf-mirror）和 LLM API 均需允许浏览器跨域；DashScope 兼容模式支持浏览器直调，Key 明文存 localStorage 并在 UI 标注「仅限本地学习，勿用于生产」。

## 实施步骤

- [x] **Step 1 持久化**：`db.ts` IndexedDB 封装；App 启动从 DB 恢复 docs，上传/删除同步落库（先不涉向量）
  - 库与版本：`minirag` v1，只建 `docs` 一个 object store（keyPath `id`）；Step 2/3 需要 `chunks`/`vectors` 时再走 `onupgradeneeded` 版本升级，这是 IndexedDB 的标准演进方式
  - `Doc` 加 `createdAt: number`：IDB 游标按 key（随机 UUID）排序，不保留插入顺序，靠 createdAt 恢复「最新在前」的列表顺序
  - `db.ts` 零依赖手写封装，API：`loadDocs()` / `putDocs(docs)` / `deleteDoc(id)` / `clearDocs()`；`open()` 缓存 Promise 保证单连接
  - 写入策略：React state 仍是单一数据源，每个变更点（上传追加、删除、清空）成功后 write-through 落库；App 挂载时 `useEffect` 从 DB 恢复
  - 失败处理：IDB 打不开（隐私模式等）→ 页面顶部横幅提示，降级为纯内存模式（现有行为）；单条写库失败 → 追加到上传错误列表
- [x] **Step 2 切块迁移**：`chunk.ts` 抽取现有 chunkDocument，加 50~100 字重叠；上传时存 chunks（随 Step 3 的 ingest 管线落库）
- [x] **Step 3 Embedding Worker**：接入 transformers.js + bge-small-zh-v1.5(q8)，Worker 批量 encode + 进度回报；向量写入 DB
  - 实际落地与原计划不同：模型权重不再从 HF CDN 远程拉取（hf-mirror 无 CORS 头、huggingface.co 国内直连不通），
    改为 `pnpm model:get` 下载到 `public/models/`，浏览器**同源加载**；CI 构建时同样拉取，GitHub Pages 产物自带 ~24MB 模型（不进 git）
  - 新增文件：`src/rag/embed.ts`（主线程 Worker 封装+请求队列）、`src/rag/ingest.ts`（切块→存块→批量编码→全成才写向量）、
    `src/rag/worker/embedWorker.ts`（WebGPU→WASM 回退、64条/批、单批重试3次）、`scripts/fetch-model.mjs`
  - DB 升级到 v2：新增 `chunks`/`vectors` store（均带 docId 索引）；UploadPage 展示索引状态/进度条/重试，删除文档同步清索引
- [x] **Step 4 向量检索**：`search.ts` 余弦 Top-K + 现有 bigram RRF 融合；ChatPage 切换调用
  - `src/rag/search.ts`：`hybridSearch(docs, question)` 向量通道（`loadChunksWithVectors` + `embedQuery`，向量已归一化、点积即余弦）
    与关键词通道（复用 `retrieve()`）各取 Top-10，RRF(k=60) 按块 id 融合取 Top-3
  - 降级路径：文档未建向量索引 / 模型加载或编码失败 → 纯关键词并如实提示原因（`mode: 'keyword'` + `reason`）
  - ChatPage：`send()` 改异步，检索中禁用发送按钮；来源卡片相关度按通道类型格式化（关键词整数 / RRF 小数 4 位）
- [ ] **Step 5 LLM 生成**：`answer.ts` Prompt 组装 + SSE 流式渲染 + 引用卡片；设置面板存 API Key/Base URL
- [ ] **Step 6 解析扩展**：pdf.js 懒加载解析 PDF；上传校验放宽到 .pdf
- [ ] **Step 7 验证评测**：构造 10 条问答对，对比纯关键词 vs 混合检索命中率；检查断网重进后模型缓存命中、数据持久化不丢

## 风险与回退

- WebGPU 不可用 → WASM 后端，速度慢 3~5 倍，仍可工作
- 模型下载受网络限制 → 支持在设置里切换 hf-mirror 源
- LLM API CORS 受阻 → 保留「仅检索展示上下文」模式（现有行为）作为降级
