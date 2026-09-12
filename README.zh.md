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

[![文件标签与对话、轨迹并列：左侧是工作区目录树，右侧是预览——可高亮源码、渲染
Markdown 与 JSON，并提供「预览/源码」切换](media/demo.gif)](media/demo.mp4)

*30 秒录屏 —— 点击可打开完整画质的 MP4。*

## 能做什么

左栏是会话的工作目录，逐层展开，目录在前；展开过的层级在切换预览标签后仍然保持。

点击文件会在标签中打开它，因此可以同时打开多个文件——每个标签有自己的预览体、
自己的换行设置。已打开的文件会被聚焦而不是重复打开；同名的标签会带上所在目录；
点标签上的 × 或中键点击即可关闭。

右栏按文件类别选择每个标签的预览体：

| 类别 | 预览 |
|---|---|
| **Markdown** | 直接渲染为 GFM —— 标题、表格、任务列表、引用、公式、脚注、高亮的代码围栏 —— 并带 **源码** 切换 |
| **JSON** | 可折叠树，每个值可单独复制，同样带 **源码** 切换 |
| **源码** | 24 种语法的语法高亮、行号与复制按钮：TypeScript/JavaScript、shell、Python、Ruby、Go、Rust、Java、C、C++、C#、Kotlin、Swift、PHP、YAML、TOML、INI、HTML、CSS、SCSS、Less、SQL、XML、Lua、MDX |
| **图片** | PNG、JPEG、GIF、WebP、AVIF、BMP、ICO、SVG，自动适配窗格。SVG 经 `<img>` 绘制，其中的脚本不会执行 |
| **其它** | 带行号的纯文本 —— 未映射的后缀（`.vue`、`.proto`、`.txt`）保持纯文本，而不是猜测一个错误的高亮 |

文本预览在空格处折行、保持单词完整；图片读取完整字节。每一种文本预览在窗格工具栏
里都有 **复制** 按钮，复制的是文件自身的文本——渲染态的 Markdown 复制的是它的
Markdown 源码。

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
- **Markdown 不解析工作区词汇**：相对图片路径与文件提及保持原样，只有绝对
  `http(s)` 图片会加载。

## 参与开发

构建、检查、产物模型，以及客户端 bundle 如何抵达浏览器：
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
