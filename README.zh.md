# dsh-file-explorer

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：
在对话视图的标签栏中新增 **文件** 标签，与 **对话**、**轨迹** 同级，左侧是会话
工作区的目录树，右侧是基本的文本预览。

```
┌──────────────────────────────────────────────────────────────────────────┐
│  工作区 / project                           [ 对话 | 轨迹 | 文件 ]      │
├───────────────────────┬──────────────────────────────────────────────────┤
│ ▾ project             │ src/client/index.ts        165 行 · 6.2KB  ⇥ ⟳  │
│   ▸ lib               │ ──────────────────────────────────────────────── │
│   ▸ node_modules      │  1 │ /**                                      │
│   ▸ scripts           │  2 │  * Browser half: register `files` as one  │
│   ▾ src               │  3 │  * Conversation View.                     │
│     ▸ client          │  4 │  */                                       │
│     index.ts          │  5 │ import type { Context } from '@deepseek-  │
│   package.json        │    │ ai/cordis'                                │
└───────────────────────┴──────────────────────────────────────────────────┘
```

## 功能

- **工作区目录树**：以会话的工作目录为根，逐层读取；目录在前，文件按自然名
  称排序。某一层在首次展开时读取，折叠后仍保留内容。
- **按文件类别选择合适的预览体**：

  | 类别 | 后缀 | 显示 |
  |---|---|---|
  | Markdown | `md` `markdown` `mkd` `mdown` `mdwn` | 直接渲染为 GFM 文档：标题、表格、任务列表、引用、KaTeX 公式、脚注，代码围栏带语法高亮；带 **源码** 切换 |
  | JSON | `json` `jsonc` `jsonl` `ndjson` `map` `webmanifest` | 可折叠树，每个值可单独复制；同样带 **源码** 切换。无法展开的文件（语法错误、被截断、或纯标量）会明确提示并显示高亮源码 |
  | 源码 | 24 种语法：TypeScript/JavaScript、shell、Python、Ruby、Go、Rust、Java、C、C++、C#、Kotlin、Swift、PHP、YAML、TOML、INI、HTML、CSS、SCSS、Less、SQL、XML、Lua、MDX | 语法高亮 + 行号 + 复制按钮 |
  | 图片 | `png` `apng` `jpg` `jpeg` `jfif` `gif` `webp` `avif` `bmp` `ico` `svg` | 直接绘制，居中并在超出时缩放到窗格宽度。SVG 通过 `<img>` 绘制，其中的脚本不会执行 |
  | 其它 | 其余全部后缀 | 带行号、可复制的纯文本 |

  未映射的语法（`.vue`、`.proto`、`.txt` 等）故意按纯文本显示，而不是猜测：错
  误的语法着色比不着色更容易误导。
- **预览读取**：文本类预览只读取前 2 000 行，图片类读取完整字节。超长行在空
  格处折行，每个单词保持完整；只有内部没有任何断点的 token（超长 URL、压缩后的
  一整段代码）才会被拆开，因为否则它只能被藏在横向滚动条之外。折行后的续行悬挂
  在正文下方，而不是行号下方。换行开关只在源码视图出现（那里才有意义）。
- **状态保留**：展开状态与当前选中文件保存在按会话独占的 store 中，因此切到
  「对话」再切回来（组件会卸载）不会丢失浏览位置。

全部为只读：插件只浏览与预览，不会写入、重命名或删除任何文件。

## 兼容性

针对 **DeepSeek Harness `0.1.5-rc.2`** 的 **Web** 界面（`dsh web`，或由
`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` 组合出的 profile）开发并
验证。插件依赖组合中的 `@deepseek-ai/dsh-api-workspace-files` 行，官方 Web
bundle 已挂载；headless / SDK 等无浏览器界面不会出现该标签。

插件本身没有配置项，`cordis.yml` 无需任何设置。

## 安装

```sh
dsh plugin --profile web add /path/to/dsh-file-explorer
dsh --profile web            # 重启 profile；bundle 成员在启动时生效
```

如果使用自定义 profile（不是官方的 `web`），先基于 Web 模板创建，以保证浏览器
组合存在：

```sh
dsh --profile myprofile --from-default-profile web
dsh plugin --profile myprofile add /path/to/dsh-file-explorer
dsh --profile myprofile
```

打开一个已有工作区的会话，点击 **文件** 标签即可。若会话没有工作区目录，标签仍
会显示，但页面会提示没有工作区目录。

### 验证安装

```sh
dsh --profile web --dump-config | grep -A 2 'dsh-file-explorer'
```

输出中应出现 `# == dsh-file-explorer` 层，以及名为 `dsh-file-explorer` 的行。
随后在运行中的 Web 界面里：开发者工具的网络面板中，插件 bundle 位于某个
`/plugins/??…` 合并响应内；插件加载后页面 head 中会出现
`<style data-dsh-file-explorer>` 标签。

## 停用与卸载

- **临时停用**：在 profile 的 `cordis.patch.yml`（在所有 bundle 层之后应用）中
  添加行覆盖：

  ```yaml
  - id: dsh-file-explorer
    disabled: true
  ```

  删掉该条目并保存即可恢复；`patchReload: live` 的 profile 无需重启。

- **卸载**：`dsh plugin --profile web remove dsh-file-explorer`，然后重启
  profile。

## 数据路径与权限

- **读取**走 Harness 自带的 `workspaceFiles` Remote 命名空间：
  `list(sessionId, path)` 读取一层目录，`read(sessionId, path, { offset, limit })`
  读取一页文本。是否可读由 Host 组合出的文件系统决定，插件自身不持有文件权限、
  不做路径解析、不接触任何凭据。
- **写入**：没有。该 Remote 命名空间不提供任何写操作。
- **存储**：没有。插件不落盘、不写会话日志；所有状态都是内存中的视图状态，
  随会话绑定一起释放。
- **Host 权限**：包的 Host 半边是空实现，不注册服务、工具、提示词片段或事件。

## 开发

```sh
npm install
npm run check     # 类型检查 + 构建两个运行产物 + 运行测试
```

`lib/index.js` 与 `lib/client.js` 是**提交进仓库的构建产物**：通过 git 或
tarball 安装时直接加载，不需要构建步骤，也不需要 `allowBuilds` 授权。

浏览器半边必须是由模块加载器接收的惰性 CommonJS 工厂，因为 dsh Web 加载器以
经典脚本方式抓取它：

```js
window.__ModuleLoader__.load({ id: 'dsh-file-explorer', factory: (require) => { … } })
```

`scripts/build.mjs` 用 esbuild 产出该形式并随后校验。只有 shell 冻结的模块表保持
外部依赖（`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-store`、
`@deepseek-ai/dsh-client-ui-primitives` 等）；其余 dsh 包都是 type-only 导入，
编译时即被擦除，因此产物中不会出现模块表无法回答的 `require`。

Markdown 渲染、JSON 树、语法高亮代码块及其行号与复制控件、以及 shiki 语法本身，
全部来自 `@deepseek-ai/dsh-client-ui-primitives`——shell 已把它共享进模块表。本插
件贡献的是格式判定与窗格本身，而不是第二套渲染器。

### 目录结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | Host 半边：空的 Loader 模块 |
| `src/client/index.ts` | 客户端插件：样式表、字典与 `conversation.view` 注册 |
| `src/client/FilesView.tsx` | 双栏页面：目录树、两处表头，以及按格式分发的预览体 |
| `src/client/format.ts` | 后缀 → 预览格式，以及语法/媒体类型表 |
| `src/client/store.ts` | 按会话独占的视图 store |
| `src/client/face.ts` | 注入面：Remote 列目录、分页读文本、整块读图片字节 |
| `src/client/styles.ts` | 插件自有样式表 |
| `src/client/locales.ts` | `fileExplorer` 字典（zh、en）与命名空间声明 |
| `cordis.patch.yml` | bundle 层：插入一行 |
| `tests/contract.test.mjs` | 针对构建产物的契约测试 |

每个源文件都是一个独立模块，文件头注释说明了其中的取舍。

## 已知限制

- **只预览，不编辑**：不写入、不保存、不做 diff。
- **Markdown 不解析工作区词汇**：Markdown 里的相对图片路径与文件提及保持原样——
  只有绝对 `http(s)` 图片会加载——因为解析它们需要阅读器为真实文件背书，而这个
  窗格不做这件事。
- **文本预览上限为前 2 000 行**：二进制或非 UTF-8 文件返回
  `workspace-file/not-text`；超过 Host 完整文件上限的返回
  `workspace-file/too-large`；更长的文本文件只展示首页并提示已截断，没有
  「加载更多」。图片受 Host 的完整文件上限约束。
- **未映射语法不高亮**：共享高亮器携带固定的语法集，集外后缀（`.vue`、
  `.proto`、`.graphql` 等）按纯文本显示，而不是近似高亮。
- **仅目录列表**：没有搜索、过滤、重命名、右键菜单、当前文件高亮，也不监听文件
  系统变化；某一层只通过 **重新读取** 更新。
- **单一根目录**：目录树以会话工作目录为根，不能向上浏览；Host 本身也拒绝读取
  工作区根之外的目录列表。
- **不做编辑**：带行号与换行开关的等宽源码视图，Markdown 则为排版后的文档——
  没有折叠、搜索和就地编辑。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
