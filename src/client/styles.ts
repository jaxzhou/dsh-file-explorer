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

/* A collapsed tree is gone at any width, and the preview takes its room. This is
   the whole of what the toggle does; the narrow layout below only decides what
   happens while the tree is *open*. */
.dsh-fe-root[data-tree='closed'] .dsh-fe-tree {
  display: none;
}

/* Below this width the two panes do not fit side by side, so they take turns:
   an open tree is the pane, and closing it is what shows the preview. The
   gesture that opens a file closes the tree as well, so a tap on a name lands on
   the file it named.

   Keep this breakpoint in step with NARROW_PANE in FilesView.tsx, which is
   what decides whether opening a file also closes the tree. */
@media (max-width: 720px) {
  .dsh-fe-tree {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    max-width: none;
    resize: none;
    border-right: 0;
  }

  .dsh-fe-root[data-tree='open'] .dsh-fe-preview {
    display: none;
  }

  /* What is open matters more than how big it is: the pane's own facts give
     their room to the tab strip and its controls rather than being truncated
     along with them. */
  .dsh-fe-meta,
  .dsh-fe-lang {
    display: none;
  }

  .dsh-fe-tabs {
    min-width: 0;
  }
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

/* A toggle that is on keeps the fill the pointer would give it, so the state is
   legible without opening the tooltip. */
.dsh-fe-tool[aria-pressed='true'] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active);
}

/* The copy button confirms in place, which is the one button whose icon changes
   rather than its fill. */
.dsh-fe-tool[data-preview-copy-state='copied'] {
  color: var(--dsw-alias-brand-primary);
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

/* The tab menu's anchor is a placeholder: the menu is positioned from the
   pointer that opened it, so this contributes nothing to the strip's layout. */
.dsh-fe-tabmenu {
  display: contents;
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

/* An HTML file is drawn by the browser, in a frame that fills the pane. The
   white canvas is the page's own, not this pane's: an unstyled document still
   reads as a document rather than as a hole in the app.

   The host takes its height from the scrollport's content box, so the frame ends
   exactly where the pane's bottom inset begins and the scrollport itself never
   scrolls — a page scrolls inside its own frame. */
.dsh-fe-html {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.dsh-fe-html-frame {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: #fff;
}

/* Rendered Markdown: prose lays out in normal white space, with the pane's
   insets and no monospace inheritance from the source view. */
.dsh-fe-prose {
  min-width: 0;
  padding: 4px 4px 0;
  font-family: var(--dsw-font-family);
  white-space: normal;
}

/* A picture in a document — a diagram this pane drew, or one the author
   referenced — centres while it fits, the way the pane's own image preview
   does. */
.dsh-fe-prose img {
  margin-inline: auto;
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

/* The downloads strip: one row per transfer the reader has running or has just
   finished. It sits between the header and the body because a download is not
   the file's preview — it belongs to the pane, and it outlives the tab that
   started it. */
.dsh-fe-downloads {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 1px;
  padding: 4px 6px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-skeleton);
}

.dsh-fe-download {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.dsh-fe-download-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-fe-download-status {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-fe-download[data-download-state='failed'] .dsh-fe-download-status {
  color: var(--dsw-alias-label-error);
}

.dsh-fe-download-control {
  flex: none;
  width: 22px;
  min-width: 22px;
  height: 22px;
  padding: 0;
}

/* PDF: the browser's own reader, filling the pane. The element has to be given
   the pane's whole height rather than a scrollport's, because the reader scrolls
   its own pages. */
.dsh-fe-pdfhost {
  display: flex;
  padding: 0;
  overflow: hidden;
}

.dsh-fe-pdf {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  border: 0;
  background: var(--dsw-alias-bg-skeleton);
}

/* A Word document, drawn from the blocks the reader unpacked. This is the
   file's own structure, so it is styled on its own rather than through the
   Markdown sheet next door. */
.dsh-fe-doc {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  /* Keep words whole and break only a token that cannot fit, which is the rule
     every text body in this pane follows. */
  overflow-wrap: break-word;
}

.dsh-fe-doc :where(h1, h2, h3, h4, h5, h6) {
  margin: 20px 0 8px;
  line-height: 1.3;
}

.dsh-fe-doc h1 { font-size: 20px; }
.dsh-fe-doc h2 { font-size: 17px; }
.dsh-fe-doc h3 { font-size: 15px; }
.dsh-fe-doc :where(h4, h5, h6) { font-size: 13px; }

.dsh-fe-doc p {
  margin: 8px 0;
}

.dsh-fe-doc blockquote {
  margin: 8px 0;
  padding: 2px 0 2px 10px;
  border-left: 3px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
}

.dsh-fe-doc-list {
  margin: 4px 0;
}

/* Each level of nesting steps further in, which is what the document meant. */
.dsh-fe-doc-list[data-depth='1'] { margin-left: 18px; }
.dsh-fe-doc-list[data-depth='2'] { margin-left: 36px; }
.dsh-fe-doc-list[data-depth='3'] { margin-left: 54px; }
.dsh-fe-doc-list[data-depth='4'] { margin-left: 72px; }

.dsh-fe-doc-list :where(ul, ol) {
  margin: 0;
  padding-left: 22px;
}

.dsh-fe-doc-list li {
  margin: 2px 0;
}

.dsh-fe-doc-table {
  max-width: 100%;
  margin: 10px 0;
  border-collapse: collapse;
}

.dsh-fe-doc-table td {
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l3);
  vertical-align: top;
}

.dsh-fe-doc-code {
  margin: 8px 0;
  padding: 8px 10px;
  overflow: auto;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  white-space: pre;
  background: var(--dsw-alias-bg-skeleton);
  border-radius: 6px;
}

.dsh-fe-doc-rule {
  margin: 12px 0;
  border: 0;
  border-top: 1px solid var(--dsw-alias-border-l3);
}

.dsh-fe-doc-image {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 8px auto;
  border-radius: 6px;
}

/* A workbook: one sheet at a time, its own scrollport, and a sticky row number
   so a wide sheet stays readable while it is scrolled sideways. */
.dsh-fe-sheet {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.dsh-fe-sheet-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 6px 8px 0;
  overflow-x: auto;
}

.dsh-fe-sheet-tab {
  flex: none;
  max-width: 180px;
  padding: 3px 10px;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 6px;
  cursor: pointer;
}

.dsh-fe-sheet-tab:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fe-sheet-tab[aria-selected='true'] {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-brand-primary);
}

.dsh-fe-sheet-scroll {
  padding: 8px;
}

.dsh-fe-sheet-table {
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.dsh-fe-sheet-table :where(td, th) {
  max-width: 320px;
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  border: 1px solid var(--dsw-alias-border-l3);
}

.dsh-fe-sheet-index {
  position: sticky;
  left: 0;
  color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
  text-align: right;
  background: var(--dsw-alias-bg-skeleton);
}

/* A deck, as an outline: one card per slide. */
.dsh-fe-slides {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dsh-fe-slide {
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
}

.dsh-fe-slide-index {
  margin-bottom: 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.dsh-fe-slide-title {
  margin: 0 0 6px;
  font-size: 15px;
}

.dsh-fe-slide-lines {
  margin: 0;
  padding-left: 20px;
}

.dsh-fe-slide-lines li {
  margin: 2px 0;
}

.dsh-fe-slide-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.dsh-fe-slide-image {
  max-width: 160px;
  max-height: 120px;
  border-radius: 4px;
}

/* ── touch ────────────────────────────────────────────────────────────── */

/* A control a finger has to hit is bigger than one a pointer has to, and it
   cannot rely on hover to reveal itself: the tab close button is invisible until
   a pointer rests on its tab, which on a touch screen is never — so a tab could
   not be closed at all. A coarse pointer is the honest signal for this, rather
   than a width, because a wide tablet has the same problem. */
@media (pointer: coarse) {
  .dsh-fe-tool {
    min-width: 34px;
    height: 34px;
    padding: 0 8px;
    font-size: 12px;
    border-radius: 17px;
  }

  .dsh-fe-tool svg {
    width: 17px;
    height: 17px;
  }

  .dsh-fe-head {
    height: 44px;
  }

  .dsh-fe-row {
    padding: 8px 10px;
  }

  .dsh-fe-tab-label {
    padding: 8px 5px 8px 10px;
  }

  .dsh-fe-tab-close {
    width: 24px;
    height: 24px;
    margin-right: 6px;
    opacity: 1;
  }

  .dsh-fe-tab {
    max-width: 160px;
  }

  .dsh-fe-sheet-tab {
    padding: 6px 12px;
  }

  .dsh-fe-download {
    gap: 10px;
    padding: 2px 0;
  }

  .dsh-fe-download-control {
    width: 30px;
    min-width: 30px;
    height: 30px;
  }

  .dsh-fe-slide-image {
    max-width: 45%;
  }
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
