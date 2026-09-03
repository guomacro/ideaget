# 03 · 前端设计：自建对话视图内的左侧栏（三栏布局）

前端遵循官方 `@deepseek-ai/dsh-client` 插件设计（双端包、`dsh.client`、
slots、Typert Remote）。**路线（已确认）：不替换官方 ui-sidebar**，而是在
conversation.view 里注册 ideaget 自己的目标视图，实现"左栏（想法/文献）+
中间（对话流）+ 右栏（详情）"三栏。本节给设计依据、结构、数据流与骨架。

## 1. 为什么 conversation.view 而不是改官方 sidebar

官方 Web 布局（`docs/subsystems/slots.md` Current hierarchy）：

```
root
├─ sidebar                    # ui-layout 声明槽位；ui-sidebar 是唯一 occupant（single）
│  ├─ sidebar.brand.mark / .name
│  ├─ sidebar.workspaces      # single：ui-workspace 占据整个会话/工作区浏览器
│  │  └─ sidebar.workspaces.directoryFlow
│  ├─ sidebar.footer.action   # list：可注入（如 settings 触发行）
│  └─ sidebar.settings
└─ conversation
   ├─ conversation.session
   │  ├─ conversation.session.header.*
   │  └─ conversation.view    # ← 目标视图选择点（chat / trajectory / 插件新增）
   │      ├─ conversation.chat.node          （keyed，chat 目标自绘）
   │      ├─ conversation.chat.assistant-actions / commandview / turnTail
   │      └─ tool.call.toolview              （keyed：工具卡片）
   ├─ conversation.composer / composer.bar / input.*（shell 拥有，位于 view 之外）
   ...
```

推论（官方扩展规则："single 与已占用的 keyed cell 视为替换点；additive 用
list id 或新 key"）：
- 左栏全局区 `sidebar.workspaces` 是 single 且被 ui-workspace 占满——想在此
  加区段 = 替换 ui-workspace 的 occupant（接管会话浏览器）或替换整个 sidebar
  shell，改动面大且违反"不 fork 官方 UI"的约束。
- `conversation.view` 是**按目标分派**的注册点：ui-chat、ui-trajectory 各注册
  一个目标；[dsh-zotero](https://github.com/Vncntvx/dsh-zotero) 已示范插件
  注册 `{ name: 'conversation.view', id: 'zotero', order: 30 }` 加一个会话内
  "Sources"页签。ideaget 在其上加**自建三栏目标视图**是既有模式的直接延伸。
- composer/输入区由 conversation shell 在 view 外渲染——**ideaget 视图无需
  重造输入框**，用户输入仍走标准 `agent.followup` 通道。

## 2. 三栏视图设计

### 会话内的目标切换

- ideaget 注册 conversation.view 条目 `id: 'ideaget'`（带 label/locale，
  `order` 排在 chat 之后），聊天区出现目标切换（页签/下拉），随会话持久。
- 每个目标是一套独立渲染：chat 与 trajectory 是"同一事件族、各自
  Definition 与最终展示模型"的官方先例（`docs/subsystems/web-client.md`），
  ideaget 视图遵循同一纪律：**自建 Definition，import 绝不跨特性包取值**。

### 布局（conversation.view 主区内）

```
┌──────────┬──────────────────────────────┬──────────────┐
│ 左栏 240px│ 中栏（对话流）               │ 右栏 320px    │
│ 想法/文献 │ 由 ideaget Definition 渲染    │ 选中对象详情   │
│          │ 的 assistant/user 消息 +      │ 元数据/摘要/   │
│  - 搜索    │ 工具卡片（MD 阅读/入库卡片）   │ 证据/关键词/   │
│  - 收藏    │                             │ 打开 PDF/入库  │
│  - 最近文献│                             │ 动作          │
└──────────┴──────────────────────────────┴──────────────┘
   输入区：conversation.composer（shell 提供，不在本视图内）
```

- 左栏数据 = **会话内投影**：由 ideaget Definition 在事件流上累积
  （`zotero` 系工具调用的结果行、用户主动收藏），不是全局库浏览
  （全局浏览放右栏"打开完整库"或独立页签，避免与会话模型耦合）。
- 中栏 = ideaget Definition 输出的对话流（对 `assistant/chunk` 文本增量、
  `tool/call`/`tool/result` 自绘；轻量版只渲染纯文本 + 关键卡片）。
- 右栏 = 点选左栏/中栏来源后的详情（metadata 只读快照 + 摘要 + 证据 +
  关键词 + 动作）。动作经注册的 inject 回调回宿主（打开本地 PDF、跳转
  `zotero://select`、把结果"加入收藏"），**组件不碰 ctx**。
- 卡片：向 `tool.call.toolview` keyed 槽注册 ideaget 工具的自定义卡片
  （MD 阅读结果卡、图片网格卡、入库状态卡），对齐官方"Web 卡片从原始
  tool/call、tool/result 事件与持久化 result.meta 派生"的规则。

### 内部扩展点（可选，v2）

若未来要允许第三方往里塞面板，由 ideaget 视图组件**自己声明并渲染**子槽
（如 `ideaget.view.rail`、`ideaget.view.details`），名字属于本包（SlotMap
声明合并 + register 调用点都在我们包内），不触碰官方槽名。

## 3. 数据流（哪些走事件、哪些走 Remote）

| 数据 | 通道 | 依据 |
|---|---|---|
| 对话文本/工具调用/结果 | 标准 session 事件 → client 侧 Definition `match`/`update`（可重放 by seq） | `docs/subsystems/conversation.md`；Definition 纪律：`match` 只读当前事件 |
| 左栏/右栏需要的结构化结果 | 工具 `output.presentationMeta` 持久化于 `tool/result`，client 从事件+meta 派生卡片/行 | `docs/cookbook/adding-a-tool.md` "Web Client presentation" |
| live 连接状态（Zotero 可达/版本/写授权） | Typert Remote namespace（`ctx.remote.$mount('ideagetRemote')` 等） | dsh-zotero 的 `zotero/status` 先例 |
| 打开本地 PDF / zotero:// | host 提供动作回调（inject face）或专用 Fetch 路由（图片字节） | 组件只拿回调，不发网络 |
| 配置卡片 | Settings namespace → `settings.plugin.item` keyed 卡片 | dsh-zotero 先例 |

原则（官方 `packages/client/AGENTS.md`）：业务数据在对象层/事件层，绝不进
组件 store；store 只放"选中项/折叠/草稿"等视图状态；locale 全部走词典。

## 4. client half 骨架（代码阶段按此建）

```
src/client/
├── index.ts            # apply(ctx)：注册 conversation.view 'ideaget'、卡片、配置卡片
├── contract.ts         # 与 host 共享的 Typert 描述符/编解码（md 阅读、状态、入库请求）
├── remote.ts           # Typert Remote 客户端贡献 + 声明合并
├── locales.ts          # zh/en 词典（NS: 'ideaget'）
├── ideaget-view.ts     # Definition：match/update → State（左栏行、中栏消息、选中详情）
├── components/
│   ├── IdeagetView.tsx      # 三栏骨架（renderSlot 自身 children）
│   ├── rail/*.tsx           # 左栏：SearchBox、SourceRow、IdeaRow
│   ├── stream/*.tsx         # 中栏：消息/卡片渲染
│   ├── details/*.tsx        # 右栏：DetailInspector、EvidenceList
│   └── cards/*.tsx          # tool.call.toolview 卡片（MdCard、ImagesCard、AddToLibraryCard）
└── ZoteroSettingsCard.tsx   # settings.plugin.item（同 dsh-zotero 卡片模式）
```

构建产物：`scripts/build-client.mjs`（esbuild）→ `lib/client.js`；依赖走
baseline externals（React/Cordis/官方 client 静态包由 shell 提供），
`@deepseek-ai/dsh-*` 只允许 `import type` 或经服务/slot 协作，不 runtime import。

## 5. 与官方内置会话浏览器（sidebar）的关系

- sidebar（ui-workspace 的会话/工作区浏览器）照常工作：新建会话、切换工作区。
- ideaget 三栏在会话内部，随会话存在；切工作区/开新会话各自独立。
- 若未来要"全局文献面板常驻侧栏"，需重新评估替换 `sidebar.workspaces`
  occupant（fork ui-workspace 浏览器），**当前路线明确不做**。
