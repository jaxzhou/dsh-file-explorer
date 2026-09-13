# dsh-file-explorer

[![npm](https://img.shields.io/npm/v/@jaxzhou/dsh-file-explorer.svg)](https://www.npmjs.com/package/@jaxzhou/dsh-file-explorer)
[![license](https://img.shields.io/npm/l/@jaxzhou/dsh-file-explorer.svg)](LICENSE)

English | [中文](README.zh.md)

> Published on npm as **`@jaxzhou/dsh-file-explorer`** — the unscoped name
> `dsh-file-explorer` belongs to a different author's plugin.

A **Files** tab for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
beside **Chat** and **Trajectory**: the session workspace as a tree, and a preview
that adapts to what the file is — rendered Markdown, a JSON tree, highlighted
source, an image, or plain text. Read-only, no configuration, nothing stored.

```sh
dsh plugin --profile web add @jaxzhou/dsh-file-explorer
dsh --profile web
```

## Demo

[![The Files tab beside Chat and Trajectory: a workspace tree on the left, and a
rendered Markdown document on the right whose toolbar carries Copy, Source and
Export PDF](media/demo.gif)](media/demo.mp4)

*15 seconds — click for the full-quality MP4.* A primary-school maths workspace: a
lesson document rendered with its tables, the **Source** toggle showing the
Markdown behind it, a second document open beside it in its own tab, and **Export
PDF**, which hands the page to the browser's print dialog.

## What you get

The left pane is the session's working directory, listed one level at a time,
directories first. An expanded level stays expanded while you move between
preview tabs.

Clicking a file opens it in a tab, so several files stay open at once — each with
its own body and its own wrap setting. A file that is already open is focused
rather than reopened, tabs whose names collide show their directory, and the tab's
× or a middle click closes one.

The right pane picks each tab's body from the file:

| Category | Preview |
|---|---|
| **Markdown** | Rendered GFM — headings, tables, task lists, quotes, math, footnotes, highlighted code fences — with a **Source** toggle, and **Export PDF** |
| **HTML** | Drawn as a page in a sandboxed frame: the file's own CSS applies, and its scripts run in an opaque origin that cannot reach this application. With a **Source** toggle, and **Export PDF** |
| **JSON** | A collapsible tree with per-value copy, and the same toggle |
| **Source code** | Syntax highlighting, line numbers, and a copy button for 24 grammars: TypeScript/JavaScript, shell, Python, Ruby, Go, Rust, Java, C, C++, C#, Kotlin, Swift, PHP, YAML, TOML, INI, HTML, CSS, SCSS, Less, SQL, XML, Lua, MDX |
| **Images** | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG, drawn to the pane. An SVG goes through `<img>`, so its scripts never run |
| **Anything else** | Numbered plain text — an unmapped suffix (`.vue`, `.proto`, `.txt`) stays plain rather than guessing a wrong grammar |

Text previews wrap at their spaces and keep every word whole; an image reads its
complete bytes. Every text body carries a **Copy** control in the pane's toolbar,
which copies the file's own text — a rendered Markdown document copies its
Markdown source. A rendered Markdown or HTML file also carries **Export PDF**,
which hands the page to the browser's print dialog: every browser offers "Save as
PDF" there, and its own layout engine keeps the text as text rather than
rasterising the page the way a canvas-based PDF library would.

## Requirements

DeepSeek Harness **0.1.5-rc.2** on the **Web** surface — `dsh web`, or a profile
composed from `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`. A headless or
SDK profile has no browser and gets no tab. The plugin declares no configuration,
so nothing in `cordis.yml` needs setting.

## Install

```sh
dsh plugin --profile web add @jaxzhou/dsh-file-explorer
dsh --profile web                 # bundle membership is read at startup
```

A custom profile needs the Web composition first:

```sh
dsh --profile myprofile --from-default-profile web
dsh plugin --profile myprofile add @jaxzhou/dsh-file-explorer
dsh --profile myprofile
```

Prefer a checkout or a git ref? Nothing needs building — the runtime artifacts are
committed:

```sh
dsh plugin --profile web add /path/to/dsh-file-explorer
dsh plugin --profile web add github:jaxzhou/dsh-file-explorer
```

Then open a session that has a workspace and click **Files**. To confirm the layer
landed:

```sh
dsh --profile web --dump-config | grep -A 2 jaxzhou-file-explorer
```

## Disable or uninstall

Disable the tab without uninstalling by adding an override to the profile's
`cordis.patch.yml` — it is applied after every bundle layer, and a
`patchReload: live` profile picks it up without a restart:

```yaml
- id: jaxzhou-file-explorer
  disabled: true
```

Uninstall with `dsh plugin --profile web remove @jaxzhou/dsh-file-explorer`, then
restart the profile.

## Privacy

- **Read-only.** Reads go through the harness's own `workspaceFiles` Remote
  namespace; the Host's filesystem decides what is readable. The plugin holds no
  file access, no path resolution, and no credentials of its own.
- **Nothing stored.** No disk writes and nothing added to the session log; view
  state lives in memory and is discarded with the session.
- **Inert Host half.** The package's Node side registers no service, tool, prompt
  section, or event.
- **HTML runs sandboxed.** A previewed page's scripts execute in an opaque origin,
  which cannot read this application's DOM, storage, or session; an exported page
  is printed with its scripts removed. An SVG draws through `<img>`, so its scripts
  never run at all.

## Known limitations

- **Preview only** — no editing, saving, or diffing.
- **Strict JSON.** Comments or a trailing comma make a file JSONC, which
  `JSON.parse` rejects — `tsconfig.json` is the common case. The pane says so and
  shows the highlighted source instead of guessing at a tree.
- **Text previews stop at 2 000 lines**, with a truncation note and no "load
  more"; binary files report why they cannot be shown.
- **Fixed grammar set.** A suffix the shared highlighter does not carry is plain
  text, never an approximation.
- **Listing only** — no search, rename, context menu, or file watching; a level
  refreshes through **Reload**.
- **Loaded previews are bounded.** A working set of five tabs keeps its content;
  an older tab stays open and reads again when you return to it.
- **One root.** The tree is rooted at the session's working directory, and the
  Host refuses directory listings outside the workspace root.
- **Markdown has no workspace vocabulary.** Relative image paths and file
  mentions stay inert; only absolute `http(s)` images load.
- **HTML previews do not resolve relative assets.** A page drawn from a Blob
  document has no base to resolve its own `style.css` or images against, so only
  absolute URLs load there too. An export prints the page as it renders without
  its scripts, which a static PDF has no use for anyway.

## Contributing

Build, checks, the artifact model, and how the client bundle reaches the browser:
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
