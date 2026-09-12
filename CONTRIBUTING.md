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
request and a client row that can answer it.

## Layout

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

## Traps this repository has already hit

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

### npm picks the README, and prefers the last candidate

npm always packs any root file matching `readme{,.*}` regardless of `files`, and
the registry picked `README.zh.md` over `README.md` — so the npm page renders the
Chinese document. Moving a translation out of the root (root-anchored pattern) is
the only reliable fix; nothing in `package.json` controls it.

Two more npm facts worth remembering:

- The npm page renders the README **captured at publish time**. Editing the README
  here does not change the page until the next version is published.
- `publint` reports `FILE_INVALID_FORMAT` for `lib/client.js` ("written in CJS,
  interpreted as ESM"). It is a **false positive**: Node never imports that file —
  the page module system evaluates it as a classic script. The harness monorepo
  suppresses the same verdict on the same files (`scripts/publint-all.ts`,
  `isBrowserBundleFormatFalsePositive`), so do not "fix" it by renaming to `.cjs`.

## Regenerating the demo

The README embeds a GIF and links the MP4 beside it. GitHub renders a committed
video only on its own file page, so the animation is what plays inline; the link
is the same recording at full quality. `media/` is documentation only — it is
outside the package's `files` list and never ships in the npm tarball.

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
npm version patch            # 0.1.0 -> 0.1.1: commits, tags
npm publish                  # prepublishOnly re-runs npm run check
git push --follow-tags
```

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
