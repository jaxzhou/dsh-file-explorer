# dsh-file-explorer

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
adds a **Files** tab to the Conversation View strip — the same level as **Chat**
and **Trajectory** — showing the session workspace as a tree with a basic text
preview beside it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Workspace / project                        [ Chat | Trajectory | Files ] │
├───────────────────────┬──────────────────────────────────────────────────┤
│ ▾ project             │ src/client/index.ts        165 lines · 6.2KB  ⇥ ⟳ │
│   ▸ lib               │ ──────────────────────────────────────────────── │
│   ▸ node_modules      │  1 │ /**                                      │
│   ▸ scripts           │  2 │  * Browser half: register `files` as one  │
│   ▾ src               │  3 │  * Conversation View.                     │
│     ▸ client          │  4 │  */                                       │
│     index.ts          │  5 │ import type { Context } from '@deepseek-  │
│   package.json        │    │ ai/cordis'                                │
└───────────────────────┴──────────────────────────────────────────────────┘
```

## Demo

[![The Files tab beside Chat and Trajectory: a workspace tree on the left, and
on the right a preview that highlights source, renders Markdown and JSON, and
offers a Rendered/Source toggle](media/demo.gif)](media/demo.mp4)

*30-second recording — click it for the full-quality MP4.* Walking a Flutter +
NestJS workspace, it previews TypeScript, Swift, Dart, HTML, YAML and JavaScript
source with syntax highlighting and line numbers, shows a `README.md` rendered
and then as source through the **Rendered / Source** toggle, and ends on a
`tsconfig.json` that explains itself before falling back to highlighted source —
its trailing comma makes it JSONC, not strict JSON, so no tree can walk it.

## What it does

- **Workspace tree.** The session's working directory, listed one level at a
  time, directories first, then files by natural name order. A level is fetched
  the first time it is expanded and kept while collapsed.
- **A preview body per file category.**

  | Category | Suffixes | Body |
  |---|---|---|
  | Markdown | `md` `markdown` `mkd` `mdown` `mdwn` | Rendered GFM document — headings, tables, task lists, quotes, KaTeX math, footnotes, and syntax-highlighted code fences — with a **Source** toggle |
  | JSON | `json` `jsonc` `jsonl` `ndjson` `map` `webmanifest` | Collapsible tree with per-value copy, with a **Source** toggle; a file the tree cannot walk says so above its highlighted source — a syntax error, a truncated page, a bare scalar, or the JSONC that `tsconfig.json` and friends actually contain |
  | Source code | 24 grammars: TypeScript/JavaScript, shell, Python, Ruby, Go, Rust, Java, C, C++, C#, Kotlin, Swift, PHP, YAML, TOML, INI, HTML, CSS, SCSS, Less, SQL, XML, Lua, MDX | Syntax-highlighted, numbered, with a copy control |
  | Images | `png` `apng` `jpg` `jpeg` `jfif` `gif` `webp` `avif` `bmp` `ico` `svg` | Drawn, centred and scaled to the pane. An SVG draws through `<img>`, so its scripts never run |
  | Anything else | every other suffix | Numbered, copyable plain text |

  An unmapped suffix (`.vue`, `.proto`, `.txt`, …) is deliberately plain text
  rather than a guess: a wrong grammar colours a file misleadingly.
- **Preview reading.** Text bodies read the file's leading 2 000 lines; an image
  reads its complete bytes. Long lines wrap at their spaces and keep every word
  whole; only a token with no break opportunity inside it — a long URL, one
  minified run — is split, because the alternative is hiding it behind a
  horizontal scrollbar. A wrapped continuation hangs under the text, not under
  the line number. The wrap toggle applies to source bodies, where it means
  something.
- **State that survives.** Expansion and the selected file live in an exclusive
  per-session store, so switching to Chat and back — which unmounts the view —
  does not lose your place.

Everything is read-only. The plugin browses and previews; it never writes,
renames, or deletes.

## Compatibility

Built and verified against **DeepSeek Harness `0.1.5-rc.2`** on the **Web**
surface (`dsh web`, or a profile composed from `@deepseek-ai/dsh-base` +
`@deepseek-ai/dsh-web-app`). It needs the Composition's
`@deepseek-ai/dsh-api-workspace-files` row, which the shipped Web bundle
mounts; a headless or SDK profile has no browser and gets no tab.

The plugin itself declares no configuration fields, so nothing in `cordis.yml`
needs setting.

## Install

```sh
dsh plugin --profile web add /path/to/dsh-file-explorer
dsh --profile web            # restart the profile; bundle membership is a startup boundary
```

For a custom profile that is not the shipped `web` one, create it from the Web
template first so the browser composition exists:

```sh
dsh --profile myprofile --from-default-profile web
dsh plugin --profile myprofile add /path/to/dsh-file-explorer
dsh --profile myprofile
```

Then open a session that has a workspace and click the **Files** tab. A session
with no workspace shows the tab strip but the view says there is no workspace
directory.

### Verify the install

```sh
dsh --profile web --dump-config | grep -A 2 'dsh-file-explorer'
```

The dump must show a `# == dsh-file-explorer` layer and a row named
`dsh-file-explorer`. Then, in the running Web UI, a browser devtools network
panel shows the plugin bundle inside one `/plugins/??…` combo response, and the
page head carries a `<style data-dsh-file-explorer>` tag once the plugin
materializes.

## Disable and uninstall

- **Disable without uninstalling** — add a row override to the profile's
  `cordis.patch.yml` (applied after every bundle layer):

  ```yaml
  - id: dsh-file-explorer
    disabled: true
  ```

  Removing that entry and saving brings the tab back: a `patchReload: live`
  profile re-applies the file without a restart.

- **Uninstall** — `dsh plugin --profile web remove dsh-file-explorer`, then
  restart the profile.

## Data path and permissions

- **Reads** go through the harness's own `workspaceFiles` Remote namespace:
  `list(sessionId, path)` for one directory level and
  `read(sessionId, path, { offset, limit })` for one text page. The Host's
  composed filesystem decides readability, so the plugin holds no file access,
  no path resolution, and no credentials of its own.
- **Writes**: none. The Remote namespace exposes no mutation operation.
- **Storage**: none. The plugin persists nothing — not to disk, not to the
  session log. All state is in-memory view state, discarded with the session
  binding.
- **Host authority**: the Host half of the package is inert; it registers no
  service, tool, prompt section, or event.

## Development

```sh
npm install
npm run check     # typecheck, build both runtime artifacts, run the tests
```

`lib/index.js` and `lib/client.js` are **committed build artifacts**: a git or
tarball install loads them directly and needs no build step or `allowBuilds`
permission.

The browser half must be a lazy CommonJS factory handoff, because the dsh Web
loader fetches it as a classic script:

```js
window.__ModuleLoader__.load({ id: 'dsh-file-explorer', factory: (require) => { … } })
```

`scripts/build.mjs` emits that shape with esbuild and then verifies it. Only the
shell's frozen module table stays external (`react`, `react/jsx-runtime`,
`@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-primitives`, …);
every other dsh package is imported type-only and erased, so no `require` in the
artifact can miss the table.

The rendered Markdown, the JSON tree, the syntax-highlighted code block, its
numbered gutter, its copy control, and the shiki grammars all come from
`@deepseek-ai/dsh-client-ui-primitives`, which the shell shares into that table.
This plugin contributes the format decision and the pane, not a second
renderer.

### Layout

| Path | Role |
|---|---|
| `src/index.ts` | Host half: an inert Loader module |
| `src/client/index.ts` | Client plugin: stylesheet, dictionaries, and the `conversation.view` registration |
| `src/client/FilesView.tsx` | The two-pane page: tree, headers, and the per-format preview bodies |
| `src/client/format.ts` | Suffix → preview format, and the grammar/media-type tables |
| `src/client/store.ts` | The exclusive per-session view store |
| `src/client/face.ts` | The injected face: Remote listing, paged text reads, and complete-byte image reads |
| `src/client/styles.ts` | The plugin-owned stylesheet |
| `src/client/locales.ts` | `fileExplorer` dictionaries (zh, en) and the namespace declaration |
| `cordis.patch.yml` | The bundle layer: one inserted row |
| `tests/contract.test.mjs` | Contract tests over the built artifacts |

Each source focus is a separate module with its own header comment; start there
for the reasoning behind a choice.

### Regenerating the demo

The README embeds a GIF and links the MP4 beside it. GitHub renders a committed
video only on its own file page, so the animation is what plays inline; the
poster frame and the link are the same recording at full quality.

```sh
SRC="screen recording.mov"
# Full-quality MP4: half the capture's width, which is a 2x screenshot's worth.
ffmpeg -i "$SRC" -vf scale=1680:-2:flags=lanczos -r 30 \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -an media/demo.mp4
# Inline GIF: fewer frames and a smaller palette, which is where the bytes go.
ffmpeg -i "$SRC" -vf "fps=12,scale=1200:-2:flags=lanczos,split[a][b];\
[a]palettegen=max_colors=128:stats_mode=diff[p];\
[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -loop 0 media/demo.gif
```

`media/` is documentation only: it is outside the package's `files` list, so it
never ships in the npm tarball.

## Known limitations

- **Preview only, no editing.** The viewer reads; it does not write, save, or
  diff.
- **JSON is parsed strictly.** A `tsconfig.json` with a trailing comma is JSONC,
  which TypeScript accepts and `JSON.parse` does not; the pane explains that and
  shows the highlighted source instead of a tree. Comments and trailing commas
  are not stripped to guess at a tree.
- **Markdown renders without workspace vocabulary.** Relative image paths and
  file mentions inside a Markdown file stay inert — only absolute `http(s)`
  images load — because resolving them would need the reader to vouch for real
  files, which this pane does not.
- **Text bodies are capped at the first 2 000 lines.** Binary and non-UTF-8
  files report `workspace-file/not-text`; files past the Host's complete-file
  cap report `workspace-file/too-large`; a longer text file shows its leading
  page with a truncation note and no "load more". An image is capped at the
  Host's complete-file limit instead.
- **No highlighting for unmapped grammars.** The shared highlighter carries a
  fixed grammar set; a suffix outside it (`.vue`, `.proto`, `.graphql`, …) shows
  as plain text rather than an approximation.
- **Listing only.** No search, filter, rename, context menu, current-file
  highlight, or filesystem watching. A level changes only through **Reload**.
- **One root.** The tree is rooted at the session's working directory; paths
  above it are not browsable, and the Host refuses directory listings outside
  the workspace root anyway.
- **No editing.** Monospaced, numbered source text with a wrapping option;
  and rendered prose for Markdown — no folding, no search, no in-place edit.

## License

MIT — see [LICENSE](LICENSE).
