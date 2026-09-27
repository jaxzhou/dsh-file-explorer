# Contributing

Everything a maintainer needs: the dev loop, the artifact model that decides what
a consumer loads, how the browser bundle reaches the page, and the two packaging
traps this repository has already hit.

Read [AGENTS.md](AGENTS.md) too — it holds the rules an agent (or anyone) must
follow when changing plugin code in this repository.

## Dev loop

```sh
npm install
npm run check     # typecheck, build both runtime artifacts, run the tests
npm run build     # just the artifacts
npm test          # just the tests
```

`npm run check` is also wired to `prepublishOnly`, so a publish cannot ship a
`lib/` that does not match the sources.

## The artifact model

`lib/index.js` (Host half) and `lib/client.js` (browser half) are **committed
build artifacts**. A git or tarball install loads them directly, which is why
installing this plugin needs no build step and no pnpm `allowBuilds` permission.

Two consequences:

- **Changing `src/` is not enough.** Run `npm run check` and commit the rebuilt
  `lib/`, or consumers keep loading the old bundle.
- **A running profile keeps its snapshot.** The client bundle is read at startup,
  so restart the profile to see a rebuild. `patchReload: live` hot-reloads
  `cordis.patch.yml` only — not `lib/client.js`.

## How the browser half reaches the page

The dsh Web loader fetches `lib/client.js` as a classic script, so the artifact
must be a lazy CommonJS factory handoff rather than an ES module:

```js
window.__ModuleLoader__.load({ id: '@jaxzhou/dsh-file-explorer', factory: (require) => { … } })
```

The `id` is the package name, and it must match — the client module system keys
its boot graph by package name.

`scripts/build.mjs` emits that shape with esbuild and then verifies it. Only
specifiers the shell's frozen module table answers may stay external (`react`,
`react/jsx-runtime`, `@deepseek-ai/dsh-client-store`,
`@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-slots`,
`@deepseek-ai/dsh-client-ui-dockkit`); everything else must be inlined. Every
other dsh package is imported **type-only** and erased at build time, so no
`require` in the artifact can miss the table.

The rendered Markdown, the JSON tree, the syntax-highlighted code block, its
numbered gutter, its copy control, and the shiki grammars all come from
`@deepseek-ai/dsh-client-ui-primitives`, which the shell shares into that table.
This plugin contributes the format decision and the pane, not a second renderer —
keep it that way, and add a runtime dependency only with a `dsh.client.external`
request and a client row that can answer it. A diagram engine is the one
deliberate exception, and it is **inlined** rather than requested as an external:
nothing on the module table answers a Mermaid, so a request for one could not be
composed.

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Host half: an inert Loader module |
| `src/client/index.ts` | Client plugin: stylesheet, dictionaries, and the `conversation.view` registration |
| `src/client/FilesView.tsx` | The two-pane page: tree, tab strip, headers, and the per-format preview bodies |
| `src/client/format.ts` | Suffix → preview format, and the grammar/media-type tables |
| `src/client/markdown-assets.ts` | The relative image destinations a Markdown document names, and where each resolves |
| `src/client/mermaid.ts` | The ```mermaid fence scan, and drawing one to the PNG the preview and both exports carry |
| `src/client/download.ts` | The windowed transfer, and the two sinks a download can go to |
| `src/client/export/` | The block model a document exports as, and the PDF, Word and zip writers |
| `src/client/DocumentPreview.tsx` | The PDF, Word, Excel and PowerPoint bodies |
| `src/client/office/` | The OOXML readers: the zip container, a small XML reader, and one reader per package |
| `src/client/store.ts` | The exclusive per-session view store: tree state, open tabs, and the bounded preview content |
| `src/client/face.ts` | The injected face: Remote listing, paged text reads, and complete-byte image reads |
| `src/client/styles.ts` | The plugin-owned stylesheet |
| `src/client/locales.ts` | `fileExplorer` dictionaries (zh, en) and the namespace declaration |
| `cordis.patch.yml` | The bundle layer: one inserted row |
| `tests/contract.test.mjs` | Contract tests over the built artifacts |

Each source focus is a separate module with its own header comment; start there
for the reasoning behind a choice.

## Traps this repository has already hit

### The palette carries no mid-grey surface in light mode

The pane headers are filled, so the chrome does not read as the first line of the
file — and only `--dsw-alias-bg-skeleton` does the job. In light mode
`bg-base`, `bg-layer-1/2/3`, `markdown-code-block` and `bg-module-platform` are
pure white or within 2% of it (a `#f9fafb` bar on a `#fff` page is invisible),
and `bg-overlay` — the one clearly distinct grey — is a menu surface that turns
mid-grey (`#61666b`) in dark mode. The wash used instead is 4% ink in light and
8% in dark, which is also light enough that a hovered control inside the row
stays visible. If the theme gains a real toolbar-surface token, use it there.

### The exports write the files themselves

There is no print dialog in this plugin: an export builds a file and downloads it.
That splits into three decisions worth knowing before changing any of it.

**The PDF is rasterised, and that is not laziness.** A text-mode PDF needs a font,
and these documents are usually Chinese — the standard 14 PDF fonts carry no CJK
glyphs, so the text would have to embed a CJK font of several megabytes in a plugin
that previews files. `html2canvas` draws the DOM instead, one pass for the whole
document (it walks the tree per call, so a call per page would lay out a long
document once per page), and `export/pdf.ts` slices that canvas into A4 pages and
writes the container: catalog, page tree, and per page a page dictionary, a content
stream, and one DCTDecode image. The container is hand-written because a PDF library
for "pages of JPEG" is hundreds of kilobytes to do what a hundred lines do — and it
is verified, not assumed: the tests parse the xref table and re-read every object
offset, and a release check renders the file with the platform PDF engine.

**The `.docx` is real OOXML**, written by `export/zip.ts` (stored entries, CRC-32)
and `export/docx.ts` (paragraphs, runs, tables, and inline pictures). Word needs no
font embedding, so the text stays text — which is the reason to offer Word beside a
raster PDF at all. Formatting is applied directly on runs and paragraphs; there is
no `styles.xml`, so there is no style-name to get wrong.

**Two dependencies are inlined, and each is imported dynamically** so its module
body does not run at plugin load: `html2canvas` at ~194 KiB minified, for the PDF
raster, and `mermaid` at ~3.3 MiB minified, for a diagram. Neither is on the
shell's module table, so neither may stay external — a bare `require` would throw
while the plugin materializes — and the single-file loader handoff has no way to
fetch a second chunk. "Lazy" here means *executed* late, not *downloaded* late:
the bytes are in `lib/client.js` either way.

Mermaid is why the client bundle is ~3.6 MiB rather than ~250 KB, and that size is
a deliberate trade, not an accident: bundling is the only way a diagram draws with
no network, no third-party request, and no Host route. Two build consequences came
with it — the client bundle is minified (an unminified inline would be ~7.9 MB),
and `trimClientMap` drops third-party sources from the shipped source map, which
otherwise grows from 372 KiB to 5.0 MiB.

**A diagram is a PNG, not the SVG mermaid draws.** It has to be: the Word writer
carries PNG and JPEG only, and the PDF is html2canvas drawing an `<img>`. So
`renderMermaidPng` rasterises the SVG through an `<img>` onto a canvas, and
`htmlLabels: false` in the initialize config is what makes that portable — a label
mermaid renders as `<foreignObject>` does not survive the trip. One raster then
serves all three consumers: the preview shows an `<img>`, html2canvas draws that
`<img>` into the PDF, and the Word writer embeds it. The placeholder the fence is
replaced with is a *relative* image destination on purpose, because that is what
routes it to the pane's own image vocabulary; that vocabulary is also where the
`data:` URL is allowed through.

An HTML export is made to stand alone first (`standaloneHtml`): its relative images
and stylesheets are read through the workspace reader and inlined, because a blob
document has no base to resolve them against — which is also why the *preview*
still shows those images missing, and why an export can carry pictures the preview
does not.

### The Office readers are the writers' other half

Previewing `.docx`, `.xlsx` and `.pptx` costs **no dependency at all**, and that
is the point of how it is built:

- **The inflater is the browser's.** `office/zip.ts` reads the central directory
  and hands each deflated entry to `DecompressionStream('deflate-raw')`. A
  third-party inflate implementation is the only thing a zip reader actually
  needs one for, and this bundle does not carry one.
- **The XML reader is a hundred lines because `DOMParser` does not exist in
  Node.** These parsers have to be testable where the tests run, so `office/xml.ts`
  parses the narrow dialect OOXML is: well-formed, machine-generated, no DTD.
  It looks elements up by *local* name, because a prefix is a binding the
  document declares rather than a name anyone can rely on.
- **The tests are round trips.** `docxFromBlocks(blocks)` → `readWord(bytes)`
  compares blocks, which is a stronger check than either side alone. That is why
  the Word writer now emits `<w:outlineLvl>` on a heading: it is direct
  formatting, so the package still needs no `styles.xml`, Word reads it as a
  heading, and the reader finds a heading by the same fact. Lists are *not*
  round-tripped — the writer types its markers into the text, so a list comes
  back as a paragraph, and the list path is covered by a hand-written fixture
  that uses `w:numPr` the way Word does.
- **Formatting is *resolved*, not read off the run.** This is the trap that made
  an early version render a real document as plain text: a Word document's runs
  carry almost nothing — `<w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr>` is a
  whole run — and the size, the weight and the justification live in
  `styles.xml`, on `w:docDefaults` and on the paragraph style the paragraph names
  (or the **default** paragraph style, where it names none, which is where a
  document's body formatting usually is). So the reader builds a style table and
  folds the chain: document defaults → paragraph style chain → character style
  chain → the run's own properties. A property an element *states* wins,
  including when it states it *off*; one it does not mention leaves the inherited
  value alone. The heading level comes from `styles.xml` too, by `w:outlineLvl`
  and then by style name — a Chinese Word names its heading styles `1`, `2`, `3`
  and gives them the name `heading 1`, so matching on the id alone finds nothing.
  Theme *fonts* are deliberately not resolved: `w:asciiTheme` needs the theme
  part, and the page's own default beats a guess.
- **Formatting lives in the shared model.** `InlineRun` carries underline,
  strikethrough, super- and subscript, colour, highlight, size and font, and the
  heading, paragraph, quote and list blocks carry `metrics` — alignment, indents,
  spacing, line height. The writer emits them back and the reader reads them, so
  the round trip covers formatting and not only text; adding a field on one side
  only breaks that, which is the point of it being a round trip.
  A highlight is written as `w:shd` rather than as `w:highlight`, because the
  named highlight covers sixteen colours and a fill covers the one the document
  used; the reader takes either spelling.
- **The ceiling is content, not layout, and it is deliberate.** Do not "fix" a
  deck rendering as an outline by adding a layout engine: a faithful slide needs
  the theme, the fonts, and every shape's geometry, which is a megabyte-scale
  dependency for a preview pane. What each reader takes is recorded in its own
  header comment.
- **Every read is bounded**, so one file cannot pin the tab: blocks, pictures,
  sheets, rows, columns and slides all have caps, and a reader that hit one
  reports `truncated` instead of growing.
- **A PDF is embedded as `<object>`, not `<iframe>`.** The element's own fallback
  content is then the browser's own "I cannot show this" signal, which is what
  keeps a browser without a PDF reader from painting an empty rectangle.

Everything a preview reads is a complete-file read, bounded by the deployment's
`workspaceFiles.maxFileBytes` (32 MiB by default). The **Download** row of the
pane's toolbar menu reads through the same path, which is why it works for a file
whose format this pane does not draw.

### A download pages through the file; it does not read it

The Host caps a **complete** read (`workspaceFiles.maxFileBytes`, 32 MiB by
default), and the file someone actually wants to download is usually well past
it — the first user report of this was a 260 MiB release tarball. So `download`
never calls `readAll`:

- `stat` gives the size, then `office`-style windows come from **`readBytes`**,
  which is capped per *window* (`maxBytes`, 2 MiB by default) and not by the
  complete-file cap. That asymmetry is the whole reason a download has no size
  limit.
- The window size is **asked for, not assumed**: a refusal with
  `workspace-file/too-large` halves it down to `MIN_READ_WINDOW_BYTES` before the
  download gives up. This bundle cannot read a deployment's `maxBytes`, so it
  must not depend on the default.
- **Two sinks**, chosen by size. Up to `SILENT_DOWNLOAD_LIMIT` the bytes are
  collected and handed over as one Blob — the silent download that was there
  before. Past it, `showSaveFilePicker` gets a file and each window is written as
  it arrives, so memory stays flat. A picker that fails for any reason other than
  the reader dismissing it (an expired gesture, a policy) falls back to collecting,
  because the download is still possible and "no" twice is not an answer.
- **Transfers live in a module-level registry**, not in the face. A face is minted
  with its view, so a map owned by one would leave a download running with nothing
  able to cancel it after a tab switch — the exact state the cancel control exists
  to prevent. Progress and outcome go to the **store**, so each of several
  concurrent downloads has its own row.
- Nothing calls `readAll` on this path, and the regression test says so: it
  downloads 40 MiB through a fake Remote whose `readAll` always fails, and asserts
  it was never called.

### A `link:` install breaks when the package is renamed

`dsh plugin --profile <p> add /path/to/checkout` records a dependency keyed by the
package's manifest name and symlinks the checkout into the profile. The profile
then follows the checkout, so **renaming the package — or only the row `name` in
`cordis.patch.yml` — breaks that profile at the next boot**, with
`failed to import loader entry … (old-name)`: the row now names a package the
profile's `node_modules` does not have.

After a rename, fix every profile that had it installed:

```sh
dsh plugin --profile web remove <old-name>
dsh plugin --profile web add @jaxzhou/dsh-file-explorer
```

### npm picks the README, and the pick is not stable

npm always packs any root file matching `readme{,.*}` regardless of `files`, and
it renders one of them as the package page. Which one is not something
`package.json` controls, and it is not stable: from tarballs whose file lists were
identical, the page rendered the English README at 0.1.7 and the Chinese one at
0.1.8.

So the translation does not live at the root. `docs/README.zh.md` is the only copy
of it, and that placement is load-bearing rather than tidiness — a root-anchored
`README.<locale>.md` re-enters the draw. The `files` list names that one path, so
the tarball carries the translation without putting a second candidate at the root.

Two more npm facts worth remembering:

- The npm page renders the README **captured at publish time**. Editing the README
  here does not change the page until the next version is published.
- `publint` reports `FILE_INVALID_FORMAT` for `lib/client.js` ("written in CJS,
  interpreted as ESM"). It is a **false positive**: Node never imports that file —
  the page module system evaluates it as a classic script. The harness monorepo
  suppresses the same verdict on the same files (`scripts/publint-all.ts`,
  `isBrowserBundleFormatFalsePositive`), so do not "fix" it by renaming to `.cjs`.

## Regenerating the demo

The committed recording is an older build, and the README says so. It predates
local images in Markdown (it shows `images/*.png` rendering as alt text), Mermaid
diagrams, the PDF and Office previews, and downloading a file from the pane at all
— and it ends on an export handing the page to the browser's print dialog, which
no export does now. Re-record it when that gap would mislead, and update both
READMEs' demo sections when you do. The README embeds a
GIF and links the MP4 beside it. GitHub renders a committed video only on its own
file page, so the animation is what plays inline; the link is the same recording at
full quality. `media/` is documentation only — it is outside the package's `files`
list and never ships in the npm tarball.

Check the result against the source before committing it: sample frames from the
GIF and from the recording at the same timestamps and confirm they show the same
screen, since a filter chain can silently drop or reorder frames.

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

## Releasing

```sh
npm version patch            # writes the manifest AND the tag together
npm publish                  # prepublishOnly re-runs npm run check
git push --follow-tags
```

Never tag by hand. `npm version` is what keeps a tag from naming a version the
manifest does not carry: this repository has already shipped a `v0.1.4` tag on a
commit whose `package.json` still said `0.1.3`, and had to withdraw it. A tag
should mark a version that exists in the manifest — and, once published, in the
registry.

Publishing needs 2FA or a granular access token with **Bypass 2FA**; the token
stored by a plain `npm login` cannot publish. `publishConfig` already pins the
public registry and `access: public`, so a machine whose default registry is a
mirror still publishes to npm.

Then verify from the registry rather than from the checkout:

```sh
dsh plugin --profile scratch --from-default-profile web
dsh plugin --profile scratch add @jaxzhou/dsh-file-explorer@<version>
dsh --profile scratch --dump-config | grep -A 2 jaxzhou-file-explorer
```
