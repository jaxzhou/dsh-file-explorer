/**
 * The explorer's stylesheet, injected as one owned `<style>` tag.
 *
 * A client bundle arriving through the module loader is a single script: the
 * loader fetches `lib/client.js` and nothing else, so a separate stylesheet
 * would never be requested. Injecting the sheet from the bundle is the same
 * mechanism the built-in packages' `clientBundle()` preset uses for global CSS,
 * and the tag is removed when the plugin unloads.
 *
 * Colours come from the shell's `--dsw-alias-*` theme tokens, so the page
 * follows the active appearance without owning any palette of its own.
 */

/** Marker attribute for this plugin's style tag. */
const STYLE_ATTRIBUTE = 'data-dsh-file-explorer'

const CSS = `
.dsh-fe-root {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
}

.dsh-fe-panes {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.dsh-fe-tree,
.dsh-fe-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.dsh-fe-tree {
  flex: 0 0 auto;
  width: 280px;
  min-width: 160px;
  max-width: 60%;
  resize: horizontal;
  overflow: hidden;
  border-right: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-fe-preview {
  flex: 1 1 auto;
  min-width: 0;
}

.dsh-fe-head {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
  box-sizing: border-box;
  height: 38px;
  padding: 0 6px 0 14px;
  /* The row is filled rather than transparent, so the pane's chrome reads as
     chrome instead of as the first line of the file. The palette's layer tokens
     are all pure white in light mode (bg-base, bg-layer-1/2/3 share a value), so
     the only token that separates a surface from the content in BOTH themes is
     this wash: 4% ink in light, 8% in dark. See the note in CONTRIBUTING.md. */
  background: var(--dsw-alias-bg-skeleton);
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

/* A grammar badge for the source body, which is where the language used to be
   named: the code block's own banner is hidden in this pane so there is exactly
   one copy control, in this row. */
.dsh-fe-lang {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  white-space: nowrap;
}

.dsh-fe-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.dsh-fe-path > span {
  direction: ltr;
  unicode-bidi: embed;
}

.dsh-fe-path-muted {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fe-meta {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.dsh-fe-tool {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  background: transparent;
  border: none;
  border-radius: 14px;
  cursor: pointer;
}

.dsh-fe-tool:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fe-tool svg {
  width: 15px;
  height: 15px;
}

.dsh-fe-scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px 8px calc(var(--dsh-composer-height, 152px) + 24px);
  overflow: auto;
  scrollbar-gutter: stable;
}

.dsh-fe-scroll::-webkit-scrollbar-track {
  margin: 2px;
}

.dsh-fe-level {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-fe-level .dsh-fe-level {
  padding-left: 16px;
}

.dsh-fe-row {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-width: 0;
  padding: 5px 10px;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
}

.dsh-fe-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fe-row[aria-current='true'] {
  background: var(--dsw-alias-interactive-bg-active);
}

.dsh-fe-row-static {
  cursor: default;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fe-row-static:hover {
  background: transparent;
}

.dsh-fe-icon {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fe-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-fe-note {
  margin: 0;
  padding: 3px 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

.dsh-fe-note-error {
  color: var(--dsw-alias-label-error);
}

.dsh-fe-status {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}

/* ── format-aware bodies ──────────────────────────────────────────────── */

/* Every body the pane can draw comes from the shared primitives, so this sheet
   carries no source-line rail of its own: the code block owns the numbered
   gutter, its counter, and its copy control. */

/* The shared CodeBlock draws the highlighted source; this host only swaps the
   chat card's chrome for the pane's: no margin, no radius, no grey fill, and
   the pane's own scroll container. */
.dsh-fe-source {
  --dsl-code-block-background: transparent;
  --dsl-code-block-border-radius: 0;
  --dsl-code-block-line-white-space: pre;
}

.dsh-fe-source .md-code-block {
  margin: 0;
}

/* One copy control per pane, in the header row above: the code block's own
   banner would be a second, inside the scrollport, and it scrolls away. The
   grammar it named is shown as the header's badge instead. Markdown fences keep
   their banners — there, a banner belongs to the fence, not to the file.

   The banner sits inside a sticky wrapper, hence the descendant match plus the
   :has rule that takes the wrapper out with it. */
.dsh-fe-source [data-code-block-banner],
.dsh-fe-source .md-code-block > div:has(> [data-code-block-banner]) {
  display: none;
}

.dsh-fe-source .md-code-block pre {
  box-sizing: border-box;
  min-width: 100%;
  padding: 8px 0;
  overflow: visible;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}

.dsh-fe-source[data-wrap='true'] {
  --dsl-code-block-line-white-space: pre-wrap;
}

.dsh-fe-source[data-wrap='true'] .md-code-block pre {
  white-space: pre-wrap;
  /* The primitive's default is break-all; keep words whole instead. */
  word-break: normal;
  overflow-wrap: break-word;
}

/* The preview pane's header row carries the open tabs and, at its end, the
   active tab's controls. The tabs take the room that is left and scroll; the
   controls never shrink away. */
.dsh-fe-tabhead {
  gap: 8px;
  padding: 0 6px 0 8px;
}

.dsh-fe-tabs {
  display: flex;
  flex: 1 1 auto;
  gap: 2px;
  align-items: stretch;
  min-width: 90px;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.dsh-fe-tabs::-webkit-scrollbar {
  height: 0;
}

.dsh-fe-tab {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-width: 0;
  max-width: 220px;
  border-radius: 8px;
}

.dsh-fe-tab:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fe-tab[data-active] {
  background: var(--dsw-alias-interactive-bg-active);
}

.dsh-fe-tab-label {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  padding: 5px 4px 5px 8px;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

.dsh-fe-tab[data-active] .dsh-fe-tab-label {
  color: var(--dsw-alias-label-primary);
}

.dsh-fe-tab-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* The close control appears for the tab under the pointer and for the active
   tab, so a full strip stays readable. */
.dsh-fe-tab-close {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 5px;
  padding: 0;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  opacity: 0;
}

.dsh-fe-tab:hover .dsh-fe-tab-close,
.dsh-fe-tab[data-active] .dsh-fe-tab-close,
.dsh-fe-tab-close:focus-visible {
  opacity: 1;
}

.dsh-fe-tab-close:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

/* A file already open in a tab keeps a quiet marker in the tree, so the reader
   can see where the strip came from without it competing with the active row. */
.dsh-fe-open-dot {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  margin-left: auto;
  background: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  opacity: 0.6;
}

/* Rendered Markdown: prose lays out in normal white space, with the pane's
   insets and no monospace inheritance from the source view. */
.dsh-fe-prose {
  min-width: 0;
  padding: 4px 4px 0;
  font-family: var(--dsw-font-family);
  white-space: normal;
}

.dsh-fe-json {
  min-width: 0;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  white-space: normal;
}

/* An image keeps its intrinsic size, centres while it fits, and scales down to
   the pane rather than overflowing it. */
.dsh-fe-imagehost {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.dsh-fe-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
`

/**
 * Install the plugin's stylesheet once, and hand back its disposer.
 * @returns a disposer removing the tag this call created, or a no-op when the sheet was already installed.
 */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[${STYLE_ATTRIBUTE}]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_ATTRIBUTE, '')
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
