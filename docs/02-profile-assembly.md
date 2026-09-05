# 02 · ideaget profile 装配设计

说明 ideaget 如何在 DSH 的 profile/bundle 机制上落地为一个可运行、可安装、
带 Web 前端的自定义 profile。机制细节以官方仓库为唯一权威，本文只做**选型与
装配设计**（官方源码只读，不修改仓库；所有产物在本项目内）。

## 1. 机制速记（为什么"基于 headless 的框架"）

官方把 profile 做成一等概念（`apps/cli/reference/README.md`、`docs/user/develop/basic/publish.md`）：

- `dsh --profile <name>` 启动 `$DSH_HOME/profiles/<name>/`：空根 `cordis.yml`（`[]`）
  上按序叠 patch 层 = `dsh.profile.bundles`（每个 bundle 的 `cordis.patch.yml`）
  → profile 自己的 `cordis.patch.yml` → 机器级 home patch → `--patch` overlay。
- 内置 profile 模板在 `packages/boot/app-boot/src/profile.ts` 的 `PROFILE_TEMPLATES`
  定义：`headless = base + headless`、`web = base + web-app`……（该文件官方只读）。
- **headless 与本项目的关系**：headless 示范的是"一个自研 surface bundle 以
  profile 组合方式运行"的机制；ideaget 需要 Web UI，因此复用**同一机制**、
  换 bundle 组合（base + web-app + ideaget），而不是真的用无 UI 的 headless 包。

## 2. 目标装配

```
dsh.profile.bundles（有序）
├─ @deepseek-ai/dsh-base        # 核心：llm/session/agent/tools/systemPrompt/settings…
├─ @deepseek-ai/dsh-web-app     # Web 表面：webserver、client 图、conversation 等
└─ ideaget                       # 本项目 bundle（host 行 + 自动发现的 client half）
```

层语义：base 提供核心行；web-app 覆盖/增补为 web 形态并挂载 Web client 组成
（它内部已含 client 模块系统与内置 UI 包行）；ideaget 的 patch 只**插入自己的行**
并对目标行做最小覆盖（见 §4）。

## 3. 装配命令与运行（开发期与分发期）

### 开发期：先在现有 web profile 上热迭代（推荐起步）

官方仓库 `pnpm dsh web --patch <abs>/cordis.yml` 只适合挂本地 overlay 做无打包
调试；对 ideaget 这种**自带 client half 的包**，最顺的开发闭环是：

```sh
# 1) 用官方 web profile 装本地 checkout（相对路径会被 dsh plugin 锚定到调用目录）
dsh plugin --profile web add /path/to/ideaget

# 2) 改 host/client 代码后只需重启 profile（bundle 成员与代码都在 node_modules 里）
dsh --profile web
```

client half 的 HMR 需要官方 `pnpm run dev:web` watcher（客户端插件重载由它驱动），
非必需：改完 `npm run build` 后重启 profile 即可。

### 分发期：独立 profile `ideaget`

```sh
# 首次：初始化时官方只给自定义名默认 base；把 web-app 也装上（它是 in-box bundle，
# 从安装锚点可解析，reconcile 会写进 bundles）
dsh plugin --profile ideaget add @deepseek-ai/dsh-web-app
# 再装本项目（本地目录 / tarball / git 均可）
dsh plugin --profile ideaget add ./ideaget          # 或 github:you/ideaget
# 启动（web-app bundle 自带命令行解析：--host/--port/--no-open）
dsh --profile ideaget --no-open
```

GitHub 安装注意（官方 `docs/user/develop/basic/publish.md`）：git 拉源码，
pnpm ≥10 默认拦 `prepare`（即本项目的 `npm run build`），需把报错 key 写进
`$DSH_HOME/profiles/ideaget/pnpm-workspace.yaml` 的 `allowBuilds` 后重跑；
建议锁 commit（`github:you/ideaget#<sha>`）。发布 npm 或 tarball 则无需此步。

### 验证装配（不启动看组合树）

```sh
dsh --profile ideaget --dump-config   # 应看到 base、web-app、ideaget 三段与各自行
```

## 4. ideaget bundle 的内容设计

### package.json 关键字段（与 dsh-zotero 同构，官方仓库只读不影响）

```jsonc
{
  "name": "ideaget",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/build-client.mjs",
    "prepare": "npm run build"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-conversation",
                 "@deepseek-ai/dsh-client-ui-session", "@deepseek-ai/dsh-client-ui-settings",
                 "@deepseek-ai/dsh-client-ui-settings-plugins", "@deepseek-ai/dsh-client-ui-slots",
                 "@deepseek-ai/dsh-client-ui-renderer"]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.2-alpha.1",
    "@deepseek-ai/dsh-system-prompt": "^0.1.2-alpha.1",
    "@deepseek-ai/dsh-settings": "^0.1.2-alpha.1",
    "@deepseek-ai/dsh-commands": "^0.1.2-alpha.1",
    "@deepseek-ai/dsh-typert-registry": "^0.1.2-alpha.1",
    "@deepseek-ai/dsh-llm": "^0.1.2-alpha.1"
  }
}
```

要点（官方 `packages/client/AGENTS.md`、`docs/cookbook/adding-a-package.md`）：
宿主服务包一律 `peerDependencies`（避免第二份 cordis）；`dsh.client.inject` 只是
信息性包名边，不决定激活顺序；client half 依赖的 `@deepseek-ai/dsh-*` 只能 peer+dev。

### cordis.patch.yml（配置层）

```yaml
# ideaget/cordis.patch.yml —— 只插入自己的行；行 id 稳定可被用户 patch 覆盖
- insert:
    - id: ideaget
      name: ideaget
      config:
        # 与 Settings namespace 同源（见设计文档 04 §配置），此处为组合基底层
        zoteroApiBaseUrl: 'http://127.0.0.1:23119/api'
        readOnly: true
```

**client half 无需在 patch 里列行**：官方 `ctx.clientModules`（`packages/client/modules`）
增量扫描**宿主 Loader 已装入的条目**中声明 `dsh.client` 的包，自动把它加进
`window.__DSH_BOOT__` 图并由 `/plugins/??ideaget/client.js` 服务。也就是说：
host 行被 loader 装入 = client half 自动被发现。这是 out-of-tree 双端插件
"一个 patch 行、两端都生效"的关键机制。

### 为什么不需要改官方仓库

- 自定义 profile：`dsh plugin --profile ideaget add …` 官方 CLI 已支持
  （`apps/cli/src/plugin.ts` 对账逻辑会自动把声明 `dsh.bundle` 的 ideaget
  写进 bundles 列表）。
- Web surface：web-app 是 in-box bundle，任意 profile 都能装。
- client 发现：无白名单，机制原生支持 out-of-tree。
- 若未来需要"官方模板里出现 ideaget"，才需要动 `PROFILE_TEMPLATES`
  （官方仓库，不在本项目范围内；可用 `dsh --profile ideaget` + 手动 bundles 达成同样效果）。

## 5. 配置与密钥存放

- **组合层默认值**：`cordis.patch.yml` 的 `config`（用户可在 profile 的
  `cordis.patch.yml` 覆盖，整块替换语义）。
- **Web 可编辑配置**：插件自己的 Settings namespace（官方 `dsh-settings`），
  保存即生效（host 端 live rebuild），参照 dsh-zotero 的配置卡片。
- **Web API key/userID（仅写通道二需要）**：走官方 credentials 能力
  （`dsh-credentials` + `.env`/settings），key 不落日志、不进 prompt。

## 6. 装配后的可验证行为清单

1. `dsh --profile ideaget --dump-config` 出现 `# == ideaget` 段。
2. 启动后 `http://127.0.0.1:3080` 可开新会话，聊天区出现 ideaget 目标页签
   （设计文档 03 的三栏视图）。
3. Settings → Plugins 出现 ideaget 配置卡片。
4. 会话内 `/ideaget status`（后端命令）显示 zotero 探测结果（版本/能力分支）。

## 7. 已实测的注册与启动步骤（2026-09，$DSH_HOME=/home/macro/.dsh）

自定义 profile 不会被官方模板预置：`dsh plugin` 首次遇到名字 `ideaget` 时只
初始化为 `[@deepseek-ai/dsh-base]`，需要再补 web-app 层。注意子命令形态是
`dsh plugin --profile <name> <pnpm args…>`（`plugin` 在 `--profile` 之前）。

```sh
# 0) 官方 CLI 用源码模式：在 deepseek-harness 目录执行 pnpm dsh（tsx 经官方
#    tsconfig paths 解析到 src；直接跑 built lib 会因产物过期缺 FiberState）
cd <deepseek-harness>

# 1) 首次注册（自动 init：manifest/cordis.patch.yml/pnpm-workspace.yaml + base 层）
#    显式钉版本：latest dist-tag 是旧的 0.0.1-rc.1，必须装 0.1.2-rc.1
pnpm dsh plugin --profile ideaget add @deepseek-ai/dsh-web-app@0.1.2-rc.1

# 2) （若 pnpm 报 ERR_PNPM_IGNORED_BUILDS）放行原生依赖构建后重跑上一条
#    $DSH_HOME/profiles/ideaget/pnpm-workspace.yaml:
#      allowBuilds:
#        koffi: false        # true 会触发 koffi 源码构建（可能很慢）；false 即可
# 3) 加入本项目（link: 指向本目录，reconcile 把 ideaget 写进 bundles）
pnpm dsh plugin --profile ideaget add /abs/path/to/ideaget
```

产物（`$DSH_HOME/profiles/ideaget/package.json`）：

```jsonc
{
  "name": "dsh-profile-ideaget",
  "dependencies": {
    "@deepseek-ai/dsh-web-app": "0.1.2-rc.1",
    "ideaget": "link:/abs/path/to/ideaget"
  },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "ideaget"],
                          "patchReload": "live" } }
}
```

### 在 ideaget 目录内启动

`dsh` 不在 PATH，且官方 tsx 需要官方 tsconfig 的 paths 映射。本项目加了本地
启动脚本（tsx 指向官方 CLI + 官方 tsconfig）：

```sh
cd <ideaget>
pnpm dsh --profile ideaget --no-open --port 3399   # 默认 3080 常被占用
```

等效手写命令：`./node_modules/.bin/tsx --tsconfig=<repo>/tsconfig.json
<repo>/apps/cli/src/bin.ts --profile ideaget …`。启动成功标志：
`dsh web: http://127.0.0.1:<port>/?token=…`。Web UI 内 conversation 区应出现
ideaget 目标（client half 由 `dsh.client` 扫描自动加入，无需官方改动）。

注意：工作区根 = 启动目录（ideaget）；勿在官方仓库目录内启动 agent 任务
（只读原则）；实测中本机 3080 被另一个 dsh web 实例占用，请换端口。
