# dsh-file-explorer

[![npm](https://img.shields.io/npm/v/@jaxzhou/dsh-file-explorer.svg)](https://www.npmjs.com/package/@jaxzhou/dsh-file-explorer)
[![license](https://img.shields.io/npm/l/@jaxzhou/dsh-file-explorer.svg)](LICENSE)

[English](README.md) | 中文

> npm 包名是 **`@jaxzhou/dsh-file-explorer`** —— 无作用域的 `dsh-file-explorer`
> 属于另一位作者的插件。

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 增加一个
**文件** 标签，与 **对话**、**轨迹** 并列：左侧是会话工作区的目录树，右侧的预览
会按文件本身决定形态 —— 渲染后的 Markdown、JSON 树、语法高亮源码、图片，或纯
文本。只读、无需配置、不落任何数据。

```sh
dsh plugin --profile web add @jaxzhou/dsh-file-explorer
dsh --profile web
```

## 演示

[![文件标签与对话、轨迹并列：左侧是工作区目录树，右侧是渲染后的 Markdown 文档，
工具栏上带复制、源码与导出 PDF](media/demo.gif)](media/demo.mp4)

*15 秒录屏 —— 点击可打开完整画质的 MP4。* 一个小数学工作区：渲染后的讲义文档
（含表格）、切到 **源码** 看它背后的 Markdown、在旁边用另一个标签打开第二份文档，
最后用 **导出 PDF** 把页面交给浏览器的打印对话框。

## 能做什么

左栏是会话的工作目录，逐层展开，目录在前；展开过的层级在切换预览标签后仍然保持。

点击文件会在标签中打开它，因此可以同时打开多个文件——每个标签有自己的预览体、
自己的换行设置。已打开的文件会被聚焦而不是重复打开；同名的标签会带上所在目录；
点标签上的 × 或中键点击即可关闭。

右栏按文件类别选择每个标签的预览体：

| 类别 | 预览 |
|---|---|
| **Markdown** | 直接渲染为 GFM —— 标题、表格、任务列表、引用、公式、脚注、引用文件旁的图片、高亮的代码围栏 —— 并带 **源码** 切换与 **导出 PDF** |
| **HTML** | 在沙箱 iframe 中当作页面绘制：文件自己的 CSS 生效，其脚本运行在不透明源（opaque origin）里，无法触达本应用。带 **源码** 切换与 **导出 PDF** |
| **JSON** | 可折叠树，每个值可单独复制，同样带 **源码** 切换 |
| **源码** | 24 种语法的语法高亮、行号与复制按钮：TypeScript/JavaScript、shell、Python、Ruby、Go、Rust、Java、C、C++、C#、Kotlin、Swift、PHP、YAML、TOML、INI、HTML、CSS、SCSS、Less、SQL、XML、Lua、MDX |
| **图片** | PNG、JPEG、GIF、WebP、AVIF、BMP、ICO、SVG，自动适配窗格。SVG 经 `<img>` 绘制，其中的脚本不会执行 |
| **其它** | 带行号的纯文本 —— 未映射的后缀（`.vue`、`.proto`、`.txt`）保持纯文本，而不是猜测一个错误的高亮 |

文本预览在空格处折行、保持单词完整；图片读取完整字节。每一种文本预览在窗格工具栏
里都有 **复制** 按钮，复制的是文件自身的文本——渲染态的 Markdown 复制的是它的
Markdown 源码。渲染态的 Markdown 与 HTML 还带 **导出 PDF**：它把页面交给浏览器的
打印对话框，那里每个浏览器都提供「另存为 PDF」，而排版由浏览器自己的引擎完成
——文字仍是文字，不像基于 canvas 的 PDF 库那样把整页栅格化。

## 环境要求

DeepSeek Harness **0.1.5-rc.2** 的 **Web** 界面 —— `dsh web`，或由
`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` 组合出的 profile。headless
或 SDK profile 没有浏览器，不会出现该标签。插件没有配置项，`cordis.yml` 无需
任何设置。

## 安装

```sh
dsh plugin --profile web add @jaxzhou/dsh-file-explorer
dsh --profile web                 # bundle 成员在启动时读取
```

自定义 profile 需要先具备 Web 组合：

```sh
dsh --profile myprofile --from-default-profile web
dsh plugin --profile myprofile add @jaxzhou/dsh-file-explorer
dsh --profile myprofile
```

偏好本地检出或 git ref？无需构建 —— 运行产物已提交：

```sh
dsh plugin --profile web add /path/to/dsh-file-explorer
dsh plugin --profile web add github:jaxzhou/dsh-file-explorer
```

然后打开一个已有工作区的会话，点击 **文件** 标签。确认层已生效：

```sh
dsh --profile web --dump-config | grep -A 2 jaxzhou-file-explorer
```

## 停用与卸载

不用卸载也能关掉这个标签：在 profile 的 `cordis.patch.yml` 里加一条行覆盖
（它在所有 bundle 层之后应用；`patchReload: live` 的 profile 无需重启即可生效）：

```yaml
- id: jaxzhou-file-explorer
  disabled: true
```

卸载：`dsh plugin --profile web remove @jaxzhou/dsh-file-explorer`，然后重启
profile。

## 隐私

- **只读**：读取走 Harness 自带的 `workspaceFiles` Remote 命名空间，可读性由
  Host 的文件系统决定。插件自身不持有文件权限、不做路径解析、不接触凭据。
- **不落数据**：不写磁盘、不写会话日志；视图状态保存在内存中，随会话一起释放。
- **Host 半边是空实现**：包的 Node 侧不注册任何服务、工具、提示词片段或事件。
- **HTML 在沙箱中运行**：预览页面的脚本执行于不透明源，无法读取本应用的 DOM、
  存储或会话；导出时会先剥除脚本再打印。SVG 经 `<img>` 绘制，脚本完全不执行。

## 已知限制

- **只预览** —— 不编辑、不保存、不做 diff。
- **JSON 按严格语法解析**：注释或尾逗号会让文件成为 JSONC，`JSON.parse` 会拒绝
  —— `tsconfig.json` 是最常见的情况。此时窗格会说明原因并显示高亮源码，而不是
  勉强猜出一棵树。
- **文本预览上限 2 000 行**，并提示已截断、没有「加载更多」；二进制文件会说明
  为何无法显示。
- **固定的语法集**：共享高亮器未包含的后缀按纯文本显示，绝不做近似高亮。
- **仅目录列表** —— 没有搜索、重命名、右键菜单，也不监听文件变化；某一层通过
  **重新读取** 更新。
- **已加载的预览有上限**：最近使用的 5 个标签保留内容；更早的标签仍然开着，只是
  回到它时会重新读取。
- **单一根目录**：目录树以会话工作目录为根，Host 本身也拒绝读取工作区根之外的
  目录列表。
- **Markdown 会读入它旁边的图片**：相对文档的图片路径会通过与文件本身相同的
  工作区读取通道加载——上限为每篇 24 张、单张 8 MiB。行内代码里的文件提及、远程
  URL、绝对路径则交给渲染器自己的规则：第一个保持原样，第二个直接加载，第三个
  不会去读。
- **HTML 预览不解析相对资源**：由 Blob 文档绘制出的页面没有可用来解析自身
  `style.css` 或图片的 base，所以同样只有绝对 URL 能加载。导出时按渲染结果打印，
  且不带脚本——静态 PDF 本来也用不上脚本。

## 参与开发

构建、检查、产物模型，以及客户端 bundle 如何抵达浏览器：
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
