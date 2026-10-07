/**
 * Contract tests for the built artifacts, run with `node --test`.
 *
 * The browser bundle is a loader factory, not a module: materializing it needs
 * a `window.__ModuleLoader__` facade plus the shell's shared module table. This
 * file supplies both with stubs and then asserts what the plugin actually
 * registers — the view id and order, the exclusive store, the injected face's
 * Remote calls, and the stylesheet — so a regression in the wiring fails here
 * instead of only in a browser.
 *
 * The store's actions are exercised through the registered handle: the stub
 * `defineStore` returns the declaration, so `store.init()` plus the plain action
 * functions are the same write set the framework binds for the component.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Minimal element stub for the stylesheet installer. */
function elementStub() {
  return { textContent: '', dataset: {}, setAttribute() {}, remove() {} }
}

/** Load the browser bundle and return the factory it registers. */
async function loadClientFactory() {
  const code = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  let registration
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { registration = value },
    },
  }
  // eslint-disable-next-line no-new-func -- the artifact is the thing under test.
  new Function(code)()
  assert.ok(registration, 'client bundle registered no factory')
  return registration
}

/** The shell's shared module table, stubbed to the names this plugin imports. */
function stubRequire() {
  const react = {
    useEffect: () => {},
    useMemo: (compute) => compute(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  }
  const noop = () => null
  return (specifier) => {
    switch (specifier) {
      case 'react': return react
      case 'react/jsx-runtime': return { jsx: noop, jsxs: noop, Fragment: 'Fragment' }
      case '@deepseek-ai/dsh-client-store': return { defineStore: (spec) => spec }
      case '@deepseek-ai/dsh-client-ui-primitives':
        return {
          CodeBlock: noop,
          FileTypeIcon: noop,
          IconFolderClose16: noop,
          IconFolderOpen16: noop,
          IconRefreshOutline16: noop,
          JsonTree: noop,
          MarkdownText: noop,
          classifyFileType: () => 'other',
          fileSizeText: bytes => `${bytes}B`,
          writeClipboard: async () => true,
        }
      default: throw new Error(`unexpected module request: ${specifier}`)
    }
  }
}

/**
 * A fake client context recording every registration the plugin makes.
 *
 * `modernBytes` leaves `readAll` off the namespace entirely, which is what makes
 * a fake shell a 0.2.0 one: the plugin keys its byte-read dialect on that method's
 * presence, not on a version string.
 */
function fakeContext({ list, read, readAll, stat, readBytes, modernBytes = false }) {
  const registrations = []
  const effects = []
  const dictionaries = []
  const styles = []
  const unconfigured = name => async () => ({ ok: false, error: { code: 'unexpected', message: name } })
  const ctx = {
    effect(callback, label) {
      const disposer = callback()
      effects.push({ label, disposer })
      return () => { if (typeof disposer === 'function') disposer() }
    },
    locale: {
      register(namespace, dicts) { dictionaries.push({ namespace, dicts }); return () => {} },
      bind: () => (key, params) => `${key}${params === undefined ? '' : JSON.stringify(params)}`,
    },
    slots: {
      inject(key, callback) { callback(); return () => {} },
      register(options, component) { registrations.push({ options, component }); return () => {} },
    },
    remote: {
      workspaceFiles: {
        list,
        read,
        ...modernBytes ? {} : { readAll: readAll ?? unconfigured('readAll') },
        stat: stat ?? unconfigured('stat'),
        readBytes: readBytes ?? unconfigured('readBytes'),
      },
    },
  }
  return { ctx, registrations, effects, dictionaries, styles }
}

/** The synchronous settlement of a stubbed Remote call. */
const settled = () => new Promise(resolve => setImmediate(resolve))

/** A recording stand-in for the bound store actions the face writes through. */
function recordingActions() {
  const writes = []
  const actions = new Proxy({}, {
    get: (_target, name) => (...args) => { writes.push([String(name), ...args]) },
  })
  return { writes, actions }
}

test('the host half is a Loader module with an inert apply', async () => {
  const module = await import(resolve(root, 'lib/index.js'))
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.apply(), undefined)
})

test('the client bundle materializes and registers one Files Conversation View', async () => {
  const registration = await loadClientFactory()
  assert.equal(registration.id, '@jaxzhou/dsh-file-explorer')
  const client = registration.factory(stubRequire())
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(client.inject, ['slots', 'locale', 'remote', 'remote.workspaceFiles'])

  const fake = fakeContext({ list: async () => ({ ok: true, value: {} }), read: async () => ({ ok: true, value: {} }) })
  client.apply(fake.ctx)

  assert.equal(fake.dictionaries.length, 1)
  assert.equal(fake.dictionaries[0].namespace, 'fileExplorer')
  assert.deepEqual(Object.keys(fake.dictionaries[0].dicts).sort(), ['en', 'zh'])

  assert.equal(fake.registrations.length, 1)
  const { options, component } = fake.registrations[0]
  assert.equal(options.name, 'conversation.view')
  assert.equal(options.id, 'files')
  assert.equal(options.order, 20)
  assert.equal(options.locale, 'fileExplorer')
  assert.equal(typeof options.label(), 'string')
  assert.equal(typeof component, 'function')
  assert.ok(options.store, 'the entry declares its exclusive Session store')
  assert.equal(typeof options.inject, 'function')
})

test('the stylesheet installer writes one owned style tag', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const fake = fakeContext({ list: async () => ({ ok: true, value: {} }), read: async () => ({ ok: true, value: {} }) })

  const created = []
  const appended = []
  globalThis.document = {
    querySelector: () => null,
    createElement: () => { const node = elementStub(); created.push(node); return node },
    head: { appendChild: node => appended.push(node) },
  }
  try {
    client.apply(fake.ctx)
    assert.equal(created.length, 1)
    assert.deepEqual(appended, created)
    const css = created[0].textContent
    assert.match(css, /\.dsh-fe-root/)
    // The format bodies and the tab strip hang off these hooks; a rename would
    // silently drop a display mode or the whole strip.
    for (const hook of [
      '.dsh-fe-source', '.dsh-fe-prose', '.dsh-fe-json', '.dsh-fe-image',
      '.dsh-fe-tabs', '.dsh-fe-tab-label', '.dsh-fe-tab-close', '.dsh-fe-open-dot',
      '.dsh-fe-lang', '.dsh-fe-html-frame',
      // The document bodies: a rename here would leave a PDF, a Word document, a
      // sheet or a deck unstyled rather than broken.
      '.dsh-fe-pdf', '.dsh-fe-doc', '.dsh-fe-doc-table', '.dsh-fe-sheet-table',
      '.dsh-fe-sheet-index', '.dsh-fe-slide',
      // A collapsed tree is hidden at every width, and a narrow pane shows one
      // pane at a time. Both are one selector each, and losing either leaves the
      // toggle doing nothing.
      ".dsh-fe-root[data-tree='closed'] .dsh-fe-tree",
      '@media (max-width: 720px)',
      ".dsh-fe-root[data-tree='open'] .dsh-fe-preview",
      // The touch adjustments, without which a finger cannot close a tab.
      '@media (pointer: coarse)',
    ]) {
      assert.ok(css.includes(hook), `stylesheet lost ${hook}`)
    }
    // Wrapping keeps words whole: the shared code block defaults to break-all,
    // so the override and the wrap variable are load-bearing.
    assert.match(css, /--dsl-code-block-line-white-space:\s*pre-wrap/)
    assert.match(css, /overflow-wrap:\s*break-word/)
    assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/)
    assert.doesNotMatch(css, /word-break:\s*break-all/)
    // The toolbar's controls are icons, so a toggle states itself by its fill;
    // there is no text label left to say which state it is in.
    assert.match(css, /\.dsh-fe-tool\[aria-pressed='true'\]/)
    // The header row must not share the content's surface, and the code block's
    // own banner must stay hidden so one copy control exists per pane.
    assert.match(css, /\.dsh-fe-head\s*\{[^}]*background:\s*var\(--dsw-alias-bg-skeleton\)/)
    // The banner must be matched as a descendant: CodeBlock nests it inside a
    // sticky wrapper, so a direct-child selector silently hides nothing.
    assert.match(css, /\.dsh-fe-source \[data-code-block-banner\]/)
    assert.match(css, /--dsl-code-block-line-white-space:\s*pre-wrap/)
  } finally {
    delete globalThis.document
  }
})

test('a page splits into the lines its own count promises', async () => {
  const registration = await loadClientFactory()
  const { previewLines } = registration.factory(stubRequire())
  assert.equal(typeof previewLines, 'function')
  // An empty file is a zero-line page, not one empty line.
  assert.deepEqual(previewLines({ text: '', lines: 0, eof: true, bytes: 0 }), [])
  // A file holding one blank line still has that line, and it must be drawn.
  assert.deepEqual(previewLines({ text: '', lines: 1, eof: true, bytes: 1 }), [''])
  assert.deepEqual(previewLines({ text: 'a\nb', lines: 2, eof: true, bytes: 3 }), ['a', 'b'])
  // Interior and trailing empty lines survive the split.
  assert.deepEqual(
    previewLines({ text: 'a\n\nb', lines: 3, eof: false, bytes: 4 }),
    ['a', '', 'b'],
  )
})

test('a file name decides its preview format', async () => {
  const registration = await loadClientFactory()
  const { previewFormatFor, hasSourceToggle, canExportPdf, extensionOf } = registration.factory(stubRequire())
  const formatOf = path => {
    const format = previewFormatFor(path)
    return { kind: format.kind, lang: format.lang, mediaType: format.mediaType }
  }

  // Suffix extraction: a dotted name is not an extension, a trailing dot is not
  // either, and separators and case do not matter.
  assert.equal(extensionOf('/a/b/README.MD'), 'md')
  assert.equal(extensionOf('C:\\proj\\main.TS'), 'ts')
  assert.equal(extensionOf('/a/.gitignore'), undefined)
  assert.equal(extensionOf('/a/name.'), undefined)
  assert.equal(extensionOf('/a/Makefile'), undefined)

  assert.deepEqual(formatOf('/a/README.md'), { kind: 'markdown', lang: 'markdown', mediaType: undefined })
  assert.deepEqual(formatOf('/a/package.json'), { kind: 'json', lang: 'json', mediaType: undefined })
  assert.deepEqual(formatOf('/a/main.ts'), { kind: 'code', lang: 'typescript', mediaType: undefined })
  assert.deepEqual(formatOf('/a/main.MTS'), { kind: 'code', lang: 'typescript', mediaType: undefined })
  assert.deepEqual(formatOf('/a/setup.py'), { kind: 'code', lang: 'python', mediaType: undefined })
  assert.deepEqual(formatOf('/a/logo.svg'), { kind: 'image', lang: undefined, mediaType: 'image/svg+xml' })
  assert.deepEqual(formatOf('/a/shot.PNG'), { kind: 'image', lang: undefined, mediaType: 'image/png' })
  // Suffixes the shared highlighter has no grammar for stay plain, never wrong.
  assert.deepEqual(formatOf('/a/App.vue'), { kind: 'text', lang: undefined, mediaType: undefined })
  assert.deepEqual(formatOf('/a/notes.txt'), { kind: 'text', lang: undefined, mediaType: undefined })
  // MDX stays on the source side: its JSX would render as prose.
  assert.deepEqual(formatOf('/a/page.mdx'), { kind: 'code', lang: 'mdx', mediaType: undefined })
  assert.deepEqual(formatOf('/a/index.html'), { kind: 'html', lang: 'html', mediaType: undefined })

  assert.equal(hasSourceToggle(previewFormatFor('/a/README.md')), true)
  assert.equal(hasSourceToggle(previewFormatFor('/a/package.json')), true)
  assert.equal(hasSourceToggle(previewFormatFor('/a/index.html')), true)
  assert.equal(hasSourceToggle(previewFormatFor('/a/main.ts')), false)
  assert.equal(hasSourceToggle(previewFormatFor('/a/logo.png')), false)

  // Only the formats whose rendered body is a document can be exported as a PDF.
  for (const file of ['/a/README.md', '/a/index.html']) {
    assert.equal(canExportPdf(previewFormatFor(file)), true, file)
  }
  for (const file of ['/a/package.json', '/a/main.ts', '/a/notes.txt', '/a/shot.png']) {
    assert.equal(canExportPdf(previewFormatFor(file)), false, file)
  }
})

test('only JSON a tree can walk parses for the tree view', async () => {
  const registration = await loadClientFactory()
  const { parseJsonDocument } = registration.factory(stubRequire())
  assert.deepEqual(parseJsonDocument('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonDocument('[1,2]'), [1, 2])
  // A truncated document, a syntax error, and a bare scalar all fall back to the
  // source view instead of a broken tree.
  assert.equal(parseJsonDocument('{"a":'), undefined)
  assert.equal(parseJsonDocument('nope'), undefined)
  assert.equal(parseJsonDocument('42'), undefined)
  assert.equal(parseJsonDocument('null'), undefined)
})

test('a document\'s relative image references are found without reading code as prose', async () => {
  const registration = await loadClientFactory()
  const { relativeImageDestinations, MAX_DOCUMENT_IMAGES } = registration.factory(stubRequire())

  // The ordinary case, with a title, a duplicate, and a pointy-bracket
  // destination (which is how a destination may hold a space).
  const text = [
    '![alt](images/g_lines.png)',
    '![alt](images/g_lines.png)',
    '![alt](images/a.png "a title")',
    "![alt](images/b.png 'another title')",
    '![alt](<images/with space.png>)',
  ].join('\n')
  assert.deepEqual(relativeImageDestinations(text), [
    'images/g_lines.png',
    'images/a.png',
    'images/b.png',
    'images/with space.png',
  ])

  // A bare destination may not contain a space, so this is not a reference and
  // must not half-match into a read of `images/with`.
  assert.deepEqual(relativeImageDestinations('![alt](images/with space.png "t")'), [])
  // Nor is a bare destination with unbalanced parentheses.
  assert.deepEqual(relativeImageDestinations('![alt](images/a(b.png)'), [])

  // Destinations this reader does not answer for: remote, absolute, fragment,
  // protocol-relative, and every other scheme.
  const foreign = [
    '![a](https://example.com/x.png)', '![a](http://example.com/x.png)',
    '![a](data:image/png;base64,AAAA)', '![a](/etc/logo.png)',
    '![a](#section)', '![a](//cdn.example.com/x.png)', '![a](mailto:x@example.com)',
    '![a](C:\\\\tmp\\\\x.png)', '![a](   )',
  ].join('\n')
  assert.deepEqual(relativeImageDestinations(foreign), [])

  // A document *about* Markdown must not fetch what its fences and inline spans
  // name. An indented code block is still scanned — telling one from a list
  // continuation needs a real parser — and that costs one read which resolves to
  // nothing, leaving the reference inert as any unresolved one is.
  const teaching = [
    '# Images',
    '',
    'Write ![alt](images/real.png) to embed a file.',
    '',
    '```markdown',
    '![alt](images/in-a-fence.png)',
    '```',
    '',
    '    ![alt](images/indented.png)',
    '',
    'Inline `![alt](images/in-code.png)` stays literal.',
  ].join('\n')
  assert.deepEqual(relativeImageDestinations(teaching), ['images/real.png', 'images/indented.png'])

  // One document cannot ask for an unbounded number of reads.
  const many = Array.from({ length: MAX_DOCUMENT_IMAGES + 5 }, (_v, index) => `![a](img${index}.png)`).join('\n')
  assert.equal(relativeImageDestinations(many).length, MAX_DOCUMENT_IMAGES)
})

test('a relative destination resolves against the document directory', async () => {
  const registration = await loadClientFactory()
  const { resolveRelativePath } = registration.factory(stubRequire())

  assert.equal(resolveRelativePath('/w/proj/', 'images/g_lines.png'), '/w/proj/images/g_lines.png')
  assert.equal(resolveRelativePath('/w/proj', './images/a.png'), '/w/proj/images/a.png')
  assert.equal(resolveRelativePath('/w/proj/docs/', '../images/a.png'), '/w/proj/images/a.png')
  assert.equal(resolveRelativePath('/w/proj/', 'a%20b.png'), '/w/proj/a b.png')
  // A malformed escape is kept as written rather than losing the reference.
  assert.equal(resolveRelativePath('/w/proj/', 'a%zz.png'), '/w/proj/a%zz.png')
  // Windows keeps its own separator and its drive segment.
  assert.equal(resolveRelativePath('C:\\w\\proj\\', 'images\\a.png'), 'C:\\w\\proj\\images\\a.png')
})

test('a mermaid fence is found wherever a document really opens one', async () => {
  const registration = await loadClientFactory()
  const { findMermaidFences } = registration.factory(stubRequire())

  const document = [
    '# Architecture',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    '~~~Mermaid',
    'sequenceDiagram',
    '  A->>B: hi',
    '~~~~',
    '',
    '```js',
    'console.log(1)',
    '```',
  ].join('\n')

  const fences = findMermaidFences(document)
  assert.equal(fences.length, 2)
  assert.equal(fences[0].code, 'flowchart LR\n  A --> B')
  assert.equal(fences[0].source, '```mermaid\nflowchart LR\n  A --> B\n```')
  // The offsets are the offsets: what they slice is the fence itself.
  assert.equal(document.slice(fences[0].start, fences[0].end), fences[0].source)
  // A tilde fence counts, the language is case-insensitive, and a longer closing
  // run closes a shorter opening one.
  assert.equal(fences[1].code, 'sequenceDiagram\n  A->>B: hi')
  assert.equal(document.slice(fences[1].start, fences[1].end), '~~~Mermaid\nsequenceDiagram\n  A->>B: hi\n~~~~')
})

test('only a real fence opens a diagram', async () => {
  const registration = await loadClientFactory()
  const { findMermaidFences } = registration.factory(stubRequire())

  // A mermaid fence quoted inside another fenced block is source text, exactly
  // as the parser the pane renders with reads it.
  assert.deepEqual(findMermaidFences(['```markdown', '```mermaid', 'A --> B', '```', '```'].join('\n')), [])
  // Four spaces of indent is an indented code block, not a fence.
  assert.deepEqual(findMermaidFences('    ```mermaid\n    A --> B\n    ```'), [])
  // A backtick fence whose info string carries a backtick is not an opening fence.
  assert.deepEqual(findMermaidFences('```mer`maid\nA --> B\n```'), [])
  // A language that merely starts with the word is a different language.
  assert.deepEqual(findMermaidFences('```mermaidjs\nA --> B\n```'), [])
  // An empty info string is plain code.
  assert.deepEqual(findMermaidFences('```\nA --> B\n```'), [])

  // A fence that never closes runs to the end of the document, as it does for
  // the parser.
  const unterminated = 'text\n\n```mermaid\nflowchart LR\n  A --> B'
  const [open] = findMermaidFences(unterminated)
  assert.equal(open.code, 'flowchart LR\n  A --> B')
  assert.equal(open.end, unterminated.length)
  assert.equal(open.source, '```mermaid\nflowchart LR\n  A --> B')

  // CRLF line endings reach the diagram without their carriage returns.
  assert.equal(findMermaidFences('```mermaid\r\nA --> B\r\n```')[0].code, 'A --> B')
})

test('a diagram fence is replaced without disturbing the document around it', async () => {
  const registration = await loadClientFactory()
  const { findMermaidFences, mermaidDestination, relativeImageDestinations, replaceMermaidFences }
    = registration.factory(stubRequire())

  const document = [
    '# A', '', 'before', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '', 'after', '',
  ].join('\n')
  const rewritten = replaceMermaidFences(document, findMermaidFences(document), () =>
    `![diagram](${mermaidDestination(0)})`)
  assert.equal(
    rewritten,
    ['# A', '', 'before', '', '![diagram](dsh-mermaid-0.png)', '', 'after', ''].join('\n'),
  )
  // The placeholder is a local destination on purpose: that is what routes it to
  // the pane's own image vocabulary rather than to the renderer's remote-image
  // allowlist, which would refuse to display it.
  assert.deepEqual(relativeImageDestinations(rewritten), ['dsh-mermaid-0.png'])

  // A document with no diagrams comes back untouched, but only when its fences
  // were genuinely absent.
  const plain = '# A\n\nno code fences here\n'
  assert.equal(replaceMermaidFences(plain, findMermaidFences(plain), () => 'x'), plain)
})

test('a diagram failure is reported as a single line', async () => {
  const registration = await loadClientFactory()
  const { mermaidErrorMessage } = registration.factory(stubRequire())

  // Mermaid's parse report repeats the diagram source across several lines; the
  // line the reader meets inline is its first.
  const report = new Error('Parse error on line 2:\n  A -->\n  ----^\nExpecting something else')
  assert.equal(mermaidErrorMessage(report), 'Parse error on line 2:')
  assert.equal(mermaidErrorMessage('just text'), 'just text')
  assert.equal(mermaidErrorMessage(new Error('')), '')
  assert.equal(mermaidErrorMessage(new Error('x'.repeat(400))).length, 200)
})


/** Join byte chunks into one array. */
function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * Build a ZIP whose entries are deflated, which is what a real Office package
 * uses. The writer next door stores its entries, so this is the only way the
 * reader's inflate path gets exercised.
 */
async function deflateZip(entries) {
  const encode = value => new TextEncoder().encode(value)
  const locals = []
  const central = []
  let offset = 0
  for (const [name, text] of entries) {
    const raw = encode(text)
    const deflated = new Uint8Array(await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer())
    const nameBytes = encode(name)
    const header = new Uint8Array(30 + nameBytes.length)
    const headerView = new DataView(header.buffer)
    headerView.setUint32(0, 0x04034b50, true)
    headerView.setUint16(4, 20, true)
    headerView.setUint16(6, 0x0800, true)
    headerView.setUint16(8, 8, true)
    headerView.setUint32(18, deflated.length, true)
    headerView.setUint32(22, raw.length, true)
    headerView.setUint16(26, nameBytes.length, true)
    header.set(nameBytes, 30)
    locals.push(header, deflated)

    const record = new Uint8Array(46 + nameBytes.length)
    const recordView = new DataView(record.buffer)
    recordView.setUint32(0, 0x02014b50, true)
    recordView.setUint16(4, 20, true)
    recordView.setUint16(6, 20, true)
    recordView.setUint16(8, 0x0800, true)
    recordView.setUint16(10, 8, true)
    recordView.setUint32(20, deflated.length, true)
    recordView.setUint32(24, raw.length, true)
    recordView.setUint16(28, nameBytes.length, true)
    recordView.setUint32(42, offset, true)
    record.set(nameBytes, 46)
    central.push(record)
    offset += header.length + deflated.length
  }
  const directory = concat(central)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, directory.length, true)
  endView.setUint32(16, offset, true)
  return concat([...locals, directory, end])
}

test('a file name decides the document it is', async () => {
  const registration = await loadClientFactory()
  const { officeKindOf, previewFormatFor, readsAllBytes } = registration.factory(stubRequire())

  assert.equal(previewFormatFor('a.pdf').kind, 'pdf')
  assert.equal(previewFormatFor('a.pdf').mediaType, 'application/pdf')
  assert.equal(previewFormatFor('a.docx').kind, 'word')
  assert.equal(previewFormatFor('a.docx').mediaType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(previewFormatFor('a.xlsx').kind, 'sheet')
  assert.equal(previewFormatFor('a.pptx').kind, 'slides')
  // The macro-enabled spellings are the same packages.
  assert.equal(previewFormatFor('a.docm').kind, 'word')
  assert.equal(previewFormatFor('a.xlsm').kind, 'sheet')
  assert.equal(previewFormatFor('a.pptm').kind, 'slides')
  // The formats before OOXML are recognised only so the pane can decline them.
  assert.equal(previewFormatFor('a.doc').kind, 'legacyOffice')
  assert.equal(previewFormatFor('a.xls').kind, 'legacyOffice')
  assert.equal(previewFormatFor('a.ppt').kind, 'legacyOffice')
  // Case does not decide anything.
  assert.equal(previewFormatFor('REPORT.PDF').kind, 'pdf')

  // A whole-file read is what a picture, a PDF and a package need; text formats
  // are still read a page at a time.
  for (const path of ['a.png', 'a.pdf', 'a.docx', 'a.xlsx', 'a.pptx']) {
    assert.equal(readsAllBytes(previewFormatFor(path)), true, path)
  }
  for (const path of ['a.md', 'a.html', 'a.json', 'a.ts', 'a.txt', 'a.doc']) {
    assert.equal(readsAllBytes(previewFormatFor(path)), false, path)
  }

  assert.equal(officeKindOf(previewFormatFor('a.docx')), 'word')
  assert.equal(officeKindOf(previewFormatFor('a.xlsx')), 'sheet')
  assert.equal(officeKindOf(previewFormatFor('a.pptx')), 'slides')
  assert.equal(officeKindOf(previewFormatFor('a.pdf')), undefined)
})

test('a package is read through its central directory, stored or deflated', async () => {
  const registration = await loadClientFactory()
  const { openZip, zip, crc32 } = registration.factory(stubRequire())

  // What the exporter writes: stored entries.
  const stored = zip([
    { name: 'word/document.xml', data: new TextEncoder().encode('<a>one</a>') },
    { name: 'word/media/image1.png', data: new Uint8Array([1, 2, 3, 4, 5]) },
  ])
  const storedArchive = openZip(stored)
  assert.deepEqual(storedArchive.names, ['word/document.xml', 'word/media/image1.png'])
  assert.equal(await storedArchive.text('word/document.xml'), '<a>one</a>')
  assert.deepEqual([...(await storedArchive.read('word/media/image1.png'))], [1, 2, 3, 4, 5])
  assert.equal(storedArchive.has('nope.xml'), false)
  assert.equal(await storedArchive.read('nope.xml'), undefined)

  // What everyone else writes: deflated entries. The CRC of the raw bytes is in
  // the archive, so this also pins the checksum both sides share.
  const deflated = await deflateZip([
    ['xl/workbook.xml', '<workbook>压缩</workbook>'],
    ['xl/worksheets/sheet1.xml', `<worksheet>${'0'.repeat(2000)}</worksheet>`],
  ])
  const deflatedArchive = openZip(deflated)
  assert.equal(await deflatedArchive.text('xl/workbook.xml'), '<workbook>压缩</workbook>')
  assert.equal((await deflatedArchive.text('xl/worksheets/sheet1.xml')).length, 2023)
  assert.equal(crc32(new TextEncoder().encode('<workbook>压缩</workbook>')) > 0, true)

  // Something that is not an archive says so, rather than reading garbage.
  assert.throws(() => openZip(new Uint8Array([1, 2, 3, 4])), /not a ZIP archive/)
})

test('the XML reader keeps text, prefixes, and references it cannot expand', async () => {
  const registration = await loadClientFactory()
  const { attribute, descendants, elements, parseXml, textContent } = registration.factory(stubRequire())

  const root = parseXml([
    '<?xml version="1.0"?>',
    '<!-- a comment -->',
    '<w:document xmlns:w="urn:w" xmlns:r="urn:r">',
    '  <w:body>',
    '    <w:p w:val="7" r:id="rId1"><w:t xml:space="preserve">a &amp; b</w:t></w:p>',
    '    <w:p><w:t>&#x4E2D;&#25991; &unknown;</w:t></w:p>',
    '    <w:p><w:t><![CDATA[<raw> & kept]]></w:t></w:p>',
    '    <w:p/>',
    '  </w:body>',
    '</w:document>',
  ].join('\n'))

  assert.equal(root.local, 'document')
  assert.equal(root.name, 'w:document')
  const body = elements(root, 'body')[0]
  const paragraphs = elements(body, 'p')
  assert.equal(paragraphs.length, 4)
  // A prefixed attribute is found by its local name, whichever prefix binds it.
  assert.equal(attribute(paragraphs[0], 'val'), '7')
  assert.equal(attribute(paragraphs[0], 'id'), 'rId1')
  assert.equal(attribute(paragraphs[0], 'missing'), undefined)
  // Named, decimal, and hexadecimal references resolve; an unknown name is kept
  // as written rather than dropped.
  assert.equal(textContent(paragraphs[0]), 'a & b')
  assert.equal(textContent(paragraphs[1]), '中文 &unknown;')
  // A CDATA section is text, entities and all.
  assert.equal(textContent(paragraphs[2]), '<raw> & kept')
  // A self-closing element has no children.
  assert.equal(paragraphs[3].children.length, 0)
  // Descendants are found across the tree, in document order.
  assert.equal(descendants(root, 't').length, 3)

  assert.throws(() => parseXml('<a><b></a>'), /closes/)
  assert.throws(() => parseXml('<a>'), /never closed/)
  assert.throws(() => parseXml('not xml'), /no root element/)
})

test('a Word document is written and read back as the same blocks', async () => {
  const registration = await loadClientFactory()
  const { docxFromBlocks, readWord } = registration.factory(stubRequire())

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const blocks = [
    { kind: 'heading', level: 2, runs: [{ text: 'Chapter' }] },
    { kind: 'paragraph', runs: [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c', code: true }] },
    { kind: 'table', rows: [{ cells: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }] }] },
    { kind: 'image', src: png, alt: 'dot', width: 40, height: 20 },
  ]
  const read = await readWord(docxFromBlocks(blocks, 'doc'))

  assert.equal(read.kind, 'word')
  assert.equal(read.truncated, false)
  // The writer marks a heading with an outline level, which is what the reader
  // finds it by — so a heading survives the trip as a heading. The metrics are
  // the writer's own spacing coming back, which is the paragraph side of the
  // round trip working.
  assert.deepEqual(read.blocks[0], {
    kind: 'heading',
    level: 2,
    runs: [{ text: 'Chapter', bold: true }],
    metrics: { before: 16, after: 8 },
  })
  assert.deepEqual(read.blocks[1], {
    kind: 'paragraph',
    // A code run comes back as both: the writer says it is monospaced by naming
    // the face, and the reader reports the face it was given.
    runs: [
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c', code: true, font: 'Consolas' },
    ],
    metrics: { after: 8 },
  })
  assert.deepEqual(read.blocks[2], blocks[2])
  // The picture comes back as the same bytes under its own media type, at the
  // size it was given.
  assert.equal(read.blocks[3].kind, 'image')
  assert.equal(read.blocks[3].src, png)
  assert.equal(read.blocks[3].width, 40)
  assert.equal(read.blocks[3].height, 20)

  await assert.rejects(readWord(new TextEncoder().encode('nope')), /not a ZIP archive|Word/)
})

test('a Word document is read the way Word writes one', async () => {
  const registration = await loadClientFactory()
  const { readWord, zip } = registration.factory(stubRequire())

  // A document as Word itself writes it: styles carry the heading level, and the
  // numbering part is what makes a list ordered.
  const document = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="urn:w" xmlns:r="urn:r" xmlns:wp="urn:wp" xmlns:a="urn:a">',
    '<w:body>',
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>',
    '<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t> not</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>two</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>bullet</w:t></w:r></w:p>',
    '<w:p><w:r><w:drawing><wp:extent cx="914400" cy="457200"/><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>',
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    '</w:body></w:document>',
  ].join('')
  const styles = '<w:styles xmlns:w="urn:w"><w:style w:type="paragraph" w:styleId="Heading1">'
    + '<w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>'
  const numbering = '<w:numbering xmlns:w="urn:w">'
    + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="5"><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + '<w:num w:numId="2"><w:abstractNumId w:val="5"/></w:num>'
    + '</w:numbering>'
  const rels = '<Relationships xmlns="urn:rels">'
    + '<Relationship Id="rId9" Type="urn:image" Target="media/image1.png"/>'
    + '<Relationship Id="rId8" Type="urn:image" Target="https://example.com/x.png" TargetMode="External"/>'
    + '</Relationships>'

  const read = await readWord(zip([
    { name: 'word/document.xml', data: new TextEncoder().encode(document) },
    { name: 'word/styles.xml', data: new TextEncoder().encode(styles) },
    { name: 'word/numbering.xml', data: new TextEncoder().encode(numbering) },
    { name: 'word/_rels/document.xml.rels', data: new TextEncoder().encode(rels) },
    { name: 'word/media/image1.png', data: new Uint8Array([137, 80, 78, 71]) },
  ]))

  assert.deepEqual(read.blocks.map(block => block.kind),
    ['heading', 'paragraph', 'list', 'list', 'list', 'image', 'table'])
  assert.deepEqual(read.blocks[0], { kind: 'heading', level: 1, runs: [{ text: '标题' }] })
  // `w:b w:val="0"` is a toggle that means off.
  assert.deepEqual(read.blocks[1], {
    kind: 'paragraph',
    runs: [{ text: 'plain ' }, { text: 'bold', bold: true }, { text: ' not' }],
  })
  // The numbering part decides which list is ordered; the second is a bullet at
  // depth one.
  assert.deepEqual(read.blocks[2], { kind: 'list', ordered: true, depth: 0, runs: [{ text: 'one' }] })
  assert.deepEqual(read.blocks[4], { kind: 'list', ordered: false, depth: 1, runs: [{ text: 'bullet' }] })
  // 914400 EMU is 96 CSS pixels, and 457200 is 48.
  assert.equal(read.blocks[5].src, 'data:image/png;base64,iVBORw==')
  assert.equal(read.blocks[5].width, 96)
  assert.equal(read.blocks[5].height, 48)
  // An external relationship's picture is never fetched.
  assert.equal(read.blocks.some(block => block.kind === 'image' && block.alt === 'x.png'), false)
})

test('a workbook is read as the cells a reader would see', async () => {
  const registration = await loadClientFactory()
  const { readSheet, zip } = registration.factory(stubRequire())

  const workbook = '<workbook xmlns="urn:x" xmlns:r="urn:r"><sheets>'
    + '<sheet name="数据" sheetId="1" r:id="rId1"/>'
    + '<sheet name="More" sheetId="2" r:id="rId2"/>'
    + '</sheets></workbook>'
  const rels = '<Relationships xmlns="urn:rels">'
    + '<Relationship Id="rId1" Type="urn:ws" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="urn:ws" Target="/xl/worksheets/sheet2.xml"/>'
    + '</Relationships>'
  // A rich shared string is its runs, not the whitespace between them.
  const shared = '<sst xmlns="urn:x"><si><t>姓名</t></si><si><r><t>A</t></r><r><t>B</t></r></si></sst>'
  const styles = '<styleSheet xmlns="urn:x"><numFmts count="1">'
    + '<numFmt numFmtId="164" formatCode="yyyy&quot;年&quot;m&quot;月&quot;"/></numFmts>'
    + '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>'
    + '</styleSheet>'
  const sheet1 = '<worksheet xmlns="urn:x"><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>42.5</v></c>'
    + '<c r="C2" s="1"><v>45000</v></c><c r="D2" s="2"><v>45000</v></c>'
    + '<c r="E2" t="b"><v>1</v></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>inline</t></is></c></row>'
    + '</sheetData></worksheet>'
  const sheet2 = '<worksheet xmlns="urn:x"><sheetData>'
    + '<row r="1"><c r="A1" t="str"><v>=1+1</v></c></row>'
    + '</sheetData></worksheet>'

  const read = await readSheet(zip([
    { name: 'xl/workbook.xml', data: new TextEncoder().encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(rels) },
    { name: 'xl/sharedStrings.xml', data: new TextEncoder().encode(shared) },
    { name: 'xl/styles.xml', data: new TextEncoder().encode(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode(sheet1) },
    { name: 'xl/worksheets/sheet2.xml', data: new TextEncoder().encode(sheet2) },
  ]))

  assert.equal(read.kind, 'sheet')
  assert.deepEqual(read.sheets.map(sheet => sheet.name), ['数据', 'More'])
  const [first, second] = read.sheets
  // A shared string is followed by index, a rich one joins its runs, a number is
  // its own text, and a boolean is TRUE/FALSE.
  assert.deepEqual(first.rows[0], { number: 1, cells: ['姓名', 'AB'] })
  // A date is a number with a date format: built-in 14 and a custom code both
  // become the day they mean. 45000 is 2023-03-15 on Excel's calendar.
  assert.deepEqual(first.rows[1], {
    number: 2,
    cells: ['姓名', '42.5', '2023-03-15', '2023-03-15', 'TRUE'],
  })
  // A row the sheet skips keeps its number, so a cell's row is the file's row.
  assert.deepEqual(first.rows[2], { number: 3, cells: [] })
  assert.deepEqual(first.rows[3], { number: 4, cells: ['inline'] })
  // A worksheet named by an absolute target resolves the same way.
  assert.deepEqual(second.rows, [{ number: 1, cells: ['=1+1'] }])
  assert.equal(second.name, 'More')

  await assert.rejects(readSheet(zip([{ name: 'a.txt', data: new Uint8Array([1]) }])), /not a workbook/)
})

test('a deck is read as an outline of itself, in presentation order', async () => {
  const registration = await loadClientFactory()
  const { readSlides, zip } = registration.factory(stubRequire())

  const presentation = '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst>'
    + '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/>'
    + '</p:sldIdLst></p:presentation>'
  // The relationship order is deliberately the reverse of the deck's, because
  // the slide list is what decides what comes first.
  const rels = '<Relationships xmlns="urn:rels">'
    + '<Relationship Id="rId2" Type="urn:slide" Target="slides/slide2.xml"/>'
    + '<Relationship Id="rId3" Type="urn:slide" Target="slides/slide1.xml"/>'
    + '</Relationships>'
  const titleSlide = '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:txBody><a:p><a:r><a:t>封面</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  const contentSlide = '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:txBody><a:p><a:r><a:t>架构</a:t></a:r></a:p></p:txBody></p:sp>'
    + '<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody>'
    + '<a:p><a:r><a:t>第一点</a:t></a:r></a:p>'
    + '<a:p><a:r><a:t>第二</a:t></a:r><a:br/><a:r><a:t>点</a:t></a:r></a:p>'
    + '</p:txBody></p:sp>'
    + '<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>'
    + '</p:spTree></p:cSld></p:sld>'
  const slideRels = '<Relationships xmlns="urn:rels">'
    + '<Relationship Id="rId1" Type="urn:image" Target="../media/image1.png"/>'
    + '</Relationships>'

  const read = await readSlides(zip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(rels) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(contentSlide) },
    { name: 'ppt/slides/slide2.xml', data: new TextEncoder().encode(titleSlide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode(slideRels) },
    { name: 'ppt/media/image1.png', data: new Uint8Array([137, 80, 78, 71]) },
  ]))

  assert.equal(read.kind, 'slides')
  assert.equal(read.slides.length, 2)
  // The first slide the deck shows is the one its slide list names first.
  assert.deepEqual(read.slides[0], { title: '封面', lines: [], images: [] })
  assert.deepEqual(read.slides[1].title, '架构')
  // A body shape's paragraphs are the text; each paragraph is one line, and a
  // break inside one starts another.
  assert.deepEqual(read.slides[1].lines, ['第一点', '第二', '点'])
  assert.deepEqual(read.slides[1].images, ['data:image/png;base64,iVBORw=='])

  await assert.rejects(
    readSlides(zip([{ name: 'a.txt', data: new Uint8Array([1]) }])),
    /not a presentation/,
  )
})

test('a document with more in it than the pane shows says so', async () => {
  const registration = await loadClientFactory()
  const { readSheet, readWord, zip } = registration.factory(stubRequire())

  // An empty document is a document, not a failure.
  const empty = await readWord(zip([
    {
      name: 'word/document.xml',
      data: new TextEncoder().encode('<w:document xmlns:w="urn:w"><w:body/></w:document>'),
    },
  ]))
  assert.deepEqual(empty, { kind: 'word', blocks: [], truncated: false })

  // A workbook with more sheets than the reader shows is cut, and says so
  // rather than growing with the file.
  const sheets = Array.from({ length: 12 }, (_value, index) =>
    `<sheet name="S${index}" sheetId="${index}" r:id="rId"/>`)
  const read = await readSheet(zip([
    {
      name: 'xl/workbook.xml',
      data: new TextEncoder().encode(
        `<workbook xmlns="urn:x" xmlns:r="urn:r"><sheets>${sheets.join('')}</sheets></workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: new TextEncoder().encode(
        '<Relationships xmlns="urn:r"><Relationship Id="rId" Type="urn:ws" Target="worksheets/sheet1.xml"/></Relationships>'),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: new TextEncoder().encode(
        '<worksheet xmlns="urn:x"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'),
    },
  ]))
  assert.equal(read.sheets.length, 8)
  assert.equal(read.truncated, true)
  assert.deepEqual(read.sheets[0].rows, [{ number: 1, cells: ['1'] }])
})

test('only a file worth streaming is streamed', async () => {
  const registration = await loadClientFactory()
  const { prefersStreamingSink, SILENT_DOWNLOAD_LIMIT } = registration.factory(stubRequire())

  // A size the backend never reported cannot be judged, so it is collected: an
  // unnecessary dialog is worse than a file held for a moment.
  assert.equal(prefersStreamingSink(undefined, true), false)
  assert.equal(prefersStreamingSink(SILENT_DOWNLOAD_LIMIT, true), false)
  assert.equal(prefersStreamingSink(SILENT_DOWNLOAD_LIMIT + 1, true), true)
  // A browser with no save dialog collects whatever the size.
  assert.equal(prefersStreamingSink(SILENT_DOWNLOAD_LIMIT + 1, false), false)
  assert.equal(prefersStreamingSink(undefined, false), false)
})

test('a file past the complete-read cap is saved a window at a time', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const { READ_WINDOW_BYTES, receiveFile } = client

  // A file eight times the Host's whole-file cap, which is the size a release
  // tarball actually is.
  const size = 40 * 1024 * 1024
  const payload = Buffer.alloc(READ_WINDOW_BYTES, 7).toString('base64')
  const requested = []
  const progress = []
  const written = []

  const result = await receiveFile({
    size,
    signal: new AbortController().signal,
    sink: {
      streaming: true,
      write: async (chunk) => { written.push(chunk.length) },
      finish: async () => { written.push('finished') },
      discard: async () => { written.push('discarded') },
    },
    onProgress: (loaded, total) => { progress.push([loaded, total]) },
    readWindow: async (offset, length) => {
      requested.push([offset, length])
      return { ok: true, data: client.bytesOfBase64(payload), eof: offset + READ_WINDOW_BYTES >= size }
    },
  })

  assert.deepEqual(result, { kind: 'done', bytes: size })
  // Every window is asked for in the size a Remote window allows, from where the
  // last one ended, and the file is read to its last byte whatever its size.
  assert.equal(requested.length, size / READ_WINDOW_BYTES)
  assert.deepEqual(requested[0], [0, READ_WINDOW_BYTES])
  assert.deepEqual(requested.at(-1), [size - READ_WINDOW_BYTES, READ_WINDOW_BYTES])
  assert.deepEqual(progress.at(-1), [size, size])
  // What was written is the file, then the sink is kept — never discarded.
  assert.equal(written.filter(entry => typeof entry === 'number').reduce((sum, entry) => sum + entry, 0), size)
  assert.deepEqual(written.at(-1), 'finished')
})

test('a window the Host refuses is asked for smaller rather than given up on', async () => {
  const registration = await loadClientFactory()
  const { MIN_READ_WINDOW_BYTES, READ_WINDOW_BYTES, receiveFile } = registration.factory(stubRequire())
  assert.ok(MIN_READ_WINDOW_BYTES < READ_WINDOW_BYTES)

  const lengths = []
  const written = []
  const result = await receiveFile({
    size: 8,
    signal: new AbortController().signal,
    sink: {
      streaming: false,
      write: async () => { written.push('wrote') },
      finish: async () => { written.push('finished') },
      discard: async () => { written.push('discarded') },
    },
    readWindow: async (offset, length) => {
      lengths.push(length)
      // A deployment capping a window far below the default: refuse until the
      // request fits, then answer.
      if (length > 512 * 1024) {
        return { ok: false, failure: { code: 'workspace-file/too-large', message: 'cap' } }
      }
      return { ok: true, data: new Uint8Array(8), eof: true }
    },
  })

  assert.deepEqual(result, { kind: 'done', bytes: 8 })
  assert.deepEqual(lengths, [READ_WINDOW_BYTES, READ_WINDOW_BYTES / 2, READ_WINDOW_BYTES / 4])
  assert.deepEqual(written, ['wrote', 'finished'])
})

test('an abandoned or refused transfer leaves nothing behind', async () => {
  const registration = await loadClientFactory()
  const { receiveFile } = registration.factory(stubRequire())

  const makeSink = () => {
    const writes = []
    return {
      writes,
      sink: {
        streaming: false,
        write: async () => { writes.push('wrote') },
        finish: async () => { writes.push('finished') },
        discard: async () => { writes.push('discarded') },
      },
    }
  }

  // Abandoned between windows: what was written is thrown away, and the transfer
  // is a cancellation rather than a failure.
  const abandoned = makeSink()
  const controller = new AbortController()
  const cancelled = await receiveFile({
    size: 100,
    signal: controller.signal,
    sink: abandoned.sink,
    readWindow: async () => {
      controller.abort()
      return { ok: true, data: new Uint8Array(10), eof: false }
    },
  })
  assert.deepEqual(cancelled, { kind: 'cancelled' })
  assert.deepEqual(abandoned.writes, ['wrote', 'discarded'])

  // A window refused for any other reason fails the download, and the part that
  // arrived is not left looking like the whole file.
  const refused = makeSink()
  const failed = await receiveFile({
    size: 100,
    signal: new AbortController().signal,
    sink: refused.sink,
    readWindow: async () => ({ ok: false, failure: { code: 'workspace-file/not-found', message: 'gone' } }),
  })
  assert.equal(failed.kind, 'failed')
  assert.equal(failed.failure.kind, 'remote')
  assert.equal(failed.failure.failure.code, 'workspace-file/not-found')
  assert.deepEqual(refused.writes, ['discarded'])

  // A Host that stops answering without claiming the end must not be read for
  // ever.
  const spinning = makeSink()
  const stuck = await receiveFile({
    size: undefined,
    signal: new AbortController().signal,
    sink: spinning.sink,
    readWindow: async () => ({ ok: true, data: new Uint8Array(0), eof: false }),
  })
  assert.equal(stuck.kind, 'failed')
  assert.equal(stuck.failure.kind, 'local')
  assert.deepEqual(spinning.writes, ['discarded'])
})

test('the save dialog is asked for only when it is wanted, and its refusal is not a failure', async () => {
  const registration = await loadClientFactory()
  const { openSink, SILENT_DOWNLOAD_LIMIT } = registration.factory(stubRequire())
  const big = SILENT_DOWNLOAD_LIMIT * 2

  try {
    // No picker in this browser: the bytes are collected, whatever the size.
    delete globalThis.showSaveFilePicker
    const collected = await openSink('a.tgz', big, 'application/gzip')
    assert.equal(collected.kind, 'sink')
    assert.equal(collected.sink.streaming, false)

    // A picker, but a file small enough not to need it: still collected.
    let asked = 0
    globalThis.showSaveFilePicker = async () => { asked++; return { createWritable: async () => ({}) } }
    const small = await openSink('a.txt', 1024, 'text/plain')
    assert.equal(small.sink.streaming, false)
    assert.equal(asked, 0)

    // A file worth streaming: the dialog names it, and the bytes go straight in.
    const chunks = []
    globalThis.showSaveFilePicker = async ({ suggestedName }) => {
      asked++
      assert.equal(suggestedName, 'a.tgz')
      return {
        createWritable: async () => ({
          write: async (chunk) => { chunks.push(chunk.length) },
          close: async () => { chunks.push('closed') },
          abort: async () => { chunks.push('aborted') },
        }),
      }
    }
    const streamed = await openSink('a.tgz', big, 'application/gzip')
    assert.equal(streamed.kind, 'sink')
    assert.equal(streamed.sink.streaming, true)
    await streamed.sink.write(new Uint8Array(4))
    await streamed.sink.finish()
    assert.deepEqual(chunks, [4, 'closed'])

    // The reader dismissing the dialog is a cancellation.
    globalThis.showSaveFilePicker = async () => {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    }
    assert.deepEqual(await openSink('a.tgz', big, 'application/gzip'), { kind: 'cancelled' })

    // A dialog that refuses for any other reason still leaves the download
    // possible, so the bytes are collected instead of the reader being told no.
    globalThis.showSaveFilePicker = async () => { throw new Error('no user gesture') }
    const fallback = await openSink('a.tgz', big, 'application/gzip')
    assert.equal(fallback.kind, 'sink')
    assert.equal(fallback.sink.streaming, false)
  } finally {
    delete globalThis.showSaveFilePicker
  }
})

test('the face downloads a file the previews could not even read whole', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const { READ_WINDOW_BYTES } = client

  const size = 40 * 1024 * 1024
  const payload = Buffer.alloc(READ_WINDOW_BYTES, 3).toString('base64')
  const calls = { stat: 0, readAll: 0, windows: [], suggested: null }
  const written = []

  const fake = fakeContext({
    list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
    read: async () => ({ ok: false, error: { code: 'workspace-file/not-text', message: 'binary' } }),
    // The whole-file read is exactly what used to fail here: a download must not
    // go near it.
    readAll: async () => ({
      ok: false,
      error: { code: 'workspace-file/too-large', message: `"big.tgz" exceeds the ${32 * 1024 * 1024} byte full-file cap` },
    }),
    stat: async () => {
      calls.stat++
      return { ok: true, value: { absolutePath: '/w/big.tgz', version: 'v1', bytes: size } }
    },
    readBytes: async (_session, _path, range) => {
      calls.windows.push([range.offset, range.length])
      return {
        ok: true,
        value: {
          absolutePath: '/w/big.tgz',
          version: 'v1',
          bytes: size,
          offset: range.offset,
          data: payload,
          eof: range.offset + READ_WINDOW_BYTES >= size,
        },
      }
    },
  })
  client.apply(fake.ctx)

  const store = fake.registrations[0].options.store
  const draft = store.init()
  store.actions.start(draft, '/w')
  const bound = Object.fromEntries(
    Object.entries(store.actions).map(([name, action]) => [name, (...args) => action(draft, ...args)]),
  )

  try {
    // The reader has a save dialog, so a file this size streams into it.
    globalThis.showSaveFilePicker = async ({ suggestedName }) => {
      calls.suggested = suggestedName
      return {
        createWritable: async () => ({
          write: async (chunk) => { written.push(chunk.length) },
          close: async () => { written.push('closed') },
          abort: async () => { written.push('aborted') },
        }),
      }
    }
    const face = fake.registrations[0].options.inject('session-1', bound)
    face.download('/w/big.tgz', 'big.tgz')
    // Every window settles on its own promise, so the transfer needs a turn per
    // window before it is done.
    for (let turn = 0; turn < 80 && draft.downloads[0]?.state.kind === 'running'; turn++) await settled()

    assert.equal(calls.readAll, 0)
    assert.equal(calls.stat, 1)
    assert.equal(calls.windows.length, size / READ_WINDOW_BYTES)
    assert.equal(calls.suggested, 'big.tgz')
    // The bytes went to the file as they arrived, the file was kept, and the row
    // says how much was saved.
    assert.equal(
      written.filter(entry => typeof entry === 'number').reduce((sum, entry) => sum + entry, 0),
      size,
    )
    assert.equal(written.at(-1), 'closed')
    assert.equal(draft.downloads.length, 1)
    assert.deepEqual(draft.downloads[0].state, { kind: 'done' })
    assert.equal(draft.downloads[0].loaded, size)
    assert.equal(draft.downloads[0].total, size)

    // A settled row is dismissed by hand, which is the only thing that removes
    // it.
    bound.downloadDismissed(draft.downloads[0].id)
    assert.deepEqual(draft.downloads, [])
  } finally {
    delete globalThis.showSaveFilePicker
  }
})

test('the pane tracks several downloads at once', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const { MAX_DOWNLOADS } = client
  const fake = fakeContext({
    list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
    read: async () => ({ ok: true, value: {} }),
  })
  client.apply(fake.ctx)
  const store = fake.registrations[0].options.store
  const d = store.init()
  store.actions.start(d, '/w')

  const task = id => ({
    id, path: `/w/${id}`, name: id, loaded: 0, total: undefined, state: { kind: 'running' },
  })
  store.actions.downloadStarted(d, task('a'))
  store.actions.downloadStarted(d, task('b'))
  assert.deepEqual(d.downloads.map(entry => entry.id), ['a', 'b'])

  // Progress belongs to one row, so two transfers running at once do not share a
  // counter.
  store.actions.downloadProgress(d, 'a', 100, 1000)
  store.actions.downloadProgress(d, 'b', 7, undefined)
  assert.equal(d.downloads[0].loaded, 100)
  assert.equal(d.downloads[0].total, 1000)
  assert.equal(d.downloads[1].loaded, 7)
  assert.equal(d.downloads[1].total, undefined)

  // One settles without touching the other.
  store.actions.downloadSettled(d, 'a', { kind: 'failed', failure: { kind: 'local', message: 'disk full' } })
  assert.deepEqual(d.downloads[0].state, { kind: 'failed', failure: { kind: 'local', message: 'disk full' } })
  assert.equal(d.downloads[1].state.kind, 'running')

  // The cap drops finished rows and never a running one, whose row is the only
  // place its cancel control exists.
  for (let index = 0; index < MAX_DOWNLOADS + 3; index++) {
    store.actions.downloadStarted(d, task(`r${index}`))
    store.actions.downloadSettled(d, `r${index}`, { kind: 'done' })
  }
  assert.ok(d.downloads.length <= MAX_DOWNLOADS)
  assert.ok(d.downloads.some(entry => entry.id === 'b' && entry.state.kind === 'running'))

  // A different workspace root is not a reason to forget a download in flight,
  // nor to bring back a file list the reader put away.
  store.actions.setTree(d, false)
  store.actions.start(d, '/other')
  assert.ok(d.downloads.some(entry => entry.id === 'b'))
  assert.equal(d.treeOpen, false)
  assert.equal(d.root, '/other')
})

test('a Word run keeps the formatting Word gave it, not only its text', async () => {
  const registration = await loadClientFactory()
  const { readWord, zip } = registration.factory(stubRequire())

  const document = '<w:document xmlns:w="urn:w"><w:body>'
    // Every basic character format, plus the two spellings that mean "no
    // underline" and "a fill rather than a named highlight".
    + '<w:p><w:r><w:rPr><w:u w:val="single"/><w:strike/></w:rPr><w:t>marked</w:t></w:r>'
    + '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r>'
    + '<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>i</w:t></w:r>'
    + '<w:r><w:rPr><w:color w:val="FF0000"/><w:highlight w:val="yellow"/></w:rPr><w:t>loud</w:t></w:r>'
    + '<w:r><w:rPr><w:u w:val="none"/></w:rPr><w:t>plain</w:t></w:r>'
    + '<w:r><w:rPr><w:shd w:val="clear" w:fill="00FF00"/></w:rPr><w:t>filled</w:t></w:r>'
    + '</w:p>'
    // Alignment is a paragraph property, in the spellings Word writes.
    + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>middle</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>spread</w:t></w:r></w:p>'
    // A quote is a style, so the styles part is what says which id means one.
    + '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>quoted</w:t></w:r></w:p>'
    + '</w:body></w:document>'
  const styles = '<w:styles xmlns:w="urn:w"><w:style w:type="paragraph" w:styleId="Quote">'
    + '<w:name w:val="Quote"/></w:style></w:styles>'

  const read = await readWord(zip([
    { name: 'word/document.xml', data: new TextEncoder().encode(document) },
    { name: 'word/styles.xml', data: new TextEncoder().encode(styles) },
  ]))

  assert.deepEqual(read.blocks.map(block => block.kind), ['paragraph', 'paragraph', 'paragraph', 'quote'])
  // A run carries what it says and nothing it does not: `w:u w:val="none"` is the
  // absence of an underline, not the presence of one.
  assert.deepEqual(read.blocks[0].runs, [
    { text: 'marked', underline: true, strike: true },
    { text: '2', sup: true },
    { text: 'i', sub: true },
    { text: 'loud', color: '#ff0000', highlight: '#ffff00' },
    { text: 'plain' },
    { text: 'filled', highlight: '#00ff00' },
  ])
  assert.equal(read.blocks[1].metrics.align, 'center')
  assert.equal(read.blocks[2].metrics.align, 'justify')
  assert.equal(read.blocks[3].kind, 'quote')
  assert.deepEqual(read.blocks[3].runs, [{ text: 'quoted' }])
})

test('basic formatting survives a Word round trip', async () => {
  const registration = await loadClientFactory()
  const { docxFromBlocks, readWord } = registration.factory(stubRequire())

  const blocks = [
    { kind: 'heading', level: 1, metrics: { align: 'center' }, runs: [{ text: 'Centred' }] },
    {
      kind: 'paragraph',
      metrics: { align: 'right' },
      runs: [
        { text: 'u', underline: true },
        { text: 's', strike: true },
        { text: 'x', sup: true },
        { text: 'i', sub: true },
        { text: 'red', color: '#ff0000' },
        { text: 'lit', highlight: '#ffff00' },
      ],
    },
  ]
  const read = await readWord(docxFromBlocks(blocks, 'doc'))

  // A heading comes back bold because the writer marks one that way as well as
  // by its outline level; its alignment is its own.
  assert.equal(read.blocks[0].metrics.align, 'center')
  assert.deepEqual(read.blocks[0].runs, [{ text: 'Centred', bold: true }])
  assert.equal(read.blocks[1].metrics.align, 'right')
  assert.deepEqual(read.blocks[1].runs, [
    { text: 'u', underline: true },
    { text: 's', strike: true },
    { text: 'x', sup: true },
    { text: 'i', sub: true },
    { text: 'red', color: '#ff0000' },
    { text: 'lit', highlight: '#ffff00' },
  ])
})

test('a Word paragraph takes its formatting from its style, not from itself', async () => {
  const registration = await loadClientFactory()
  const { readWord, zip } = registration.factory(stubRequire())

  // A document shaped the way Word writes one: the runs carry nothing, and the
  // size, the weight and the justification all live in the styles part. This is
  // the case that used to render as plain text — a real document's body text is
  // justified and 10.5pt because its Normal style says so, not because any run
  // repeats it.
  const styles = '<w:styles xmlns:w="urn:w">'
    + '<w:docDefaults><w:rPrDefault><w:rPr>'
    + '<w:rFonts w:ascii="Arial" w:eastAsia="宋体"/><w:sz w:val="21"/>'
    + '</w:rPr></w:rPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/>'
    + '<w:pPr><w:jc w:val="both"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/>'
    + '<w:basedOn w:val="a"/>'
    + '<w:pPr><w:spacing w:before="340" w:after="330" w:line="360" w:lineRule="auto"/>'
    + '<w:outlineLvl w:val="0"/></w:pPr>'
    + '<w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/>'
    + '<w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr></w:style>'
    + '</w:styles>'
  const document = '<w:document xmlns:w="urn:w"><w:body>'
    // The localized spelling: a Chinese Word names its heading styles `1`, `2`.
    + '<w:p><w:pPr><w:pStyle w:val="1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>'
    // No paragraph properties at all: everything below comes from the default.
    + '<w:p><w:r><w:t>正文</w:t></w:r></w:p>'
    + '<w:p><w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>强调</w:t></w:r></w:p>'
    + '</w:body></w:document>'

  const read = await readWord(zip([
    { name: 'word/document.xml', data: new TextEncoder().encode(document) },
    { name: 'word/styles.xml', data: new TextEncoder().encode(styles) },
  ]))

  assert.deepEqual(read.blocks.map(block => block.kind), ['heading', 'paragraph', 'paragraph'])
  // 44 half-points is 22pt is 29px; the line is 360/240 of a line; 340 twips is
  // 23px and 330 is 22px. The paragraph's own `w:jc` beats the style's.
  assert.deepEqual(read.blocks[0], {
    kind: 'heading',
    level: 1,
    runs: [{ text: '标题', bold: true, size: 29, font: '宋体, Arial' }],
    metrics: { align: 'center', before: 23, after: 22, lineHeight: 1.5 },
  })
  // A paragraph that says nothing still gets the default style's justification
  // and the document's own size and faces.
  assert.deepEqual(read.blocks[1], {
    kind: 'paragraph',
    runs: [{ text: '正文', size: 14, font: '宋体, Arial' }],
    metrics: { align: 'justify' },
  })
  // A character style adds to what the paragraph established rather than
  // replacing it.
  assert.deepEqual(read.blocks[2], {
    kind: 'paragraph',
    runs: [{ text: '强调', italic: true, color: '#ff0000', size: 14, font: '宋体, Arial' }],
    metrics: { align: 'justify' },
  })
})

test('tab labels disambiguate only the basenames that clash', async () => {
  const registration = await loadClientFactory()
  const { tabLabels } = registration.factory(stubRequire())
  assert.deepEqual(
    tabLabels(['/w/a.ts', '/w/README.md']),
    { '/w/a.ts': 'a.ts', '/w/README.md': 'README.md' },
  )
  // Two files with one name carry their parent; the unrelated one does not.
  assert.deepEqual(
    tabLabels(['/w/src/index.ts', '/w/test/index.ts', '/w/package.json']),
    {
      '/w/src/index.ts': 'src/index.ts',
      '/w/test/index.ts': 'test/index.ts',
      '/w/package.json': 'package.json',
    },
  )
  // Windows separators and a trailing separator still yield a parent name.
  assert.deepEqual(
    tabLabels(['C:\\w\\src\\index.ts', 'C:\\w\\test\\index.ts']),
    { 'C:\\w\\src\\index.ts': 'src/index.ts', 'C:\\w\\test\\index.ts': 'test/index.ts' },
  )
})

test('the store opens one tab per file, focuses and closes like an editor', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const fake = fakeContext({ list: async () => ({ ok: true, value: {} }), read: async () => ({ ok: true, value: {} }) })
  client.apply(fake.ctx)
  const store = fake.registrations[0].options.store
  const d = store.init()
  store.actions.start(d, '/w')

  // Opening the same file twice focuses the tab instead of duplicating it.
  store.actions.openFile(d, '/w/a.ts')
  store.actions.openFile(d, '/w/b.ts')
  store.actions.openFile(d, '/w/a.ts')
  assert.deepEqual(d.open, ['/w/a.ts', '/w/b.ts'])
  assert.equal(d.active, '/w/a.ts')

  // Activation stays inside the open set.
  store.actions.activate(d, '/w/absent.ts')
  assert.equal(d.active, '/w/a.ts')
  store.actions.activate(d, '/w/b.ts')
  assert.equal(d.active, '/w/b.ts')

  // Per-tab preferences are keyed by path, so one tab's choices stay its own.
  store.actions.setWrap(d, '/w/a.ts', false)
  store.actions.setMode(d, '/w/b.ts', 'source')
  assert.deepEqual(d.wraps, { '/w/a.ts': false })
  assert.deepEqual(d.modes, { '/w/b.ts': 'source' })

  // Closing the active tab shows the neighbour that took its slot.
  store.actions.openFile(d, '/w/c.ts')
  store.actions.activate(d, '/w/b.ts')
  store.actions.closeFile(d, '/w/b.ts')
  assert.deepEqual(d.open, ['/w/a.ts', '/w/c.ts'])
  assert.equal(d.active, '/w/c.ts')
  assert.equal(d.modes['/w/b.ts'], undefined)
  assert.equal(d.previews['/w/b.ts'], undefined)

  // Closing a background tab leaves the active one alone; closing the last
  // tab leaves nothing shown.
  store.actions.closeFile(d, '/w/a.ts')
  assert.equal(d.active, '/w/c.ts')
  store.actions.closeFile(d, '/w/c.ts')
  assert.deepEqual(d.open, [])
  assert.equal(d.active, null)

  // A settlement for a closed tab writes nothing.
  store.actions.previewLoaded(d, '/w/c.ts', { kind: 'text', page: { text: 'x', lines: 1, eof: true, bytes: 1 } })
  assert.equal(d.previews['/w/c.ts'], undefined)
})

test('the store retains the active tab plus a bounded working set', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const fake = fakeContext({ list: async () => ({ ok: true, value: {} }), read: async () => ({ ok: true, value: {} }) })
  client.apply(fake.ctx)
  const { RETAINED_PREVIEWS } = client
  const store = fake.registrations[0].options.store
  const d = store.init()
  store.actions.start(d, '/w')

  const paths = Array.from({ length: RETAINED_PREVIEWS + 3 }, (_value, index) => `/w/f${index}.ts`)
  for (const path of paths) {
    store.actions.openFile(d, path)
    store.actions.previewLoaded(d, path, { kind: 'text', page: { text: 'x', lines: 1, eof: true, bytes: 1 } })
  }
  // Every tab stays open; only the loaded content is bounded.
  assert.equal(d.open.length, paths.length)
  assert.equal(Object.keys(d.previews).length, RETAINED_PREVIEWS)
  assert.ok(d.previews[paths.at(-1)], 'the active tab keeps its content')
  assert.equal(d.previews[paths[0]], undefined, 'the least recently used tab was dropped')

  // Naming a dropped tab makes it the working set again, and dropping content
  // never removes the tab itself.
  store.actions.activate(d, paths[0])
  assert.equal(d.active, paths[0])
  assert.equal(d.previews[paths[0]], undefined)
  store.actions.previewLoaded(d, paths[0], { kind: 'text', page: { text: 'x', lines: 1, eof: true, bytes: 1 } })
  assert.ok(d.previews[paths[0]])
  assert.equal(d.open.length, paths.length)
})

test('the injected face lists directories and reads the tab it is asked for', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const calls = []
  const fake = fakeContext({
    list: async (...args) => {
      calls.push(['list', ...args])
      return { ok: true, value: { path: '', entries: [{ name: 'a', type: 'file' }], truncated: false } }
    },
    read: async (...args) => {
      calls.push(['read', ...args])
      return { ok: true, value: { text: 'hello', lines: 1, eof: true, bytes: 5 } }
    },
  })
  client.apply(fake.ctx)

  const { writes, actions } = recordingActions()
  const face = fake.registrations[0].options.inject('session-1', actions)

  face.list('/tmp')
  await settled()
  assert.deepEqual(calls[0].slice(0, 3), ['list', 'session-1', '/tmp'])
  assert.deepEqual(writes[0], ['loading', '/tmp'])
  assert.deepEqual(writes[1], ['loaded', '/tmp', { entries: [{ name: 'a', type: 'file' }], truncated: false }])

  face.read('/tmp/a.txt')
  await settled()
  assert.deepEqual(calls[1].slice(0, 3), ['read', 'session-1', '/tmp/a.txt'])
  assert.deepEqual(calls[1][3], { offset: 1, limit: 2000 })
  assert.deepEqual(writes[2], ['reading', '/tmp/a.txt'])
  assert.deepEqual(writes[3], ['previewLoaded', '/tmp/a.txt', {
    kind: 'text', page: { text: 'hello', lines: 1, eof: true, bytes: 5 },
  }])

  // A second read of the same tab retires the first: only the newer settlement
  // is written, which is what makes Reload safe against a slow first response.
  face.read('/tmp/a.txt')
  await settled()
  assert.equal(writes.filter(write => write[0] === 'previewLoaded').length, 2)
  assert.equal(writes.filter(write => write[0] === 'reading').length, 2)
})

test('an image format reads complete bytes instead of a page of lines', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const calls = []
  const fake = fakeContext({
    list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
    read: async (...args) => { calls.push(['read', ...args]); return { ok: true, value: {} } },
    readAll: async (...args) => {
      calls.push(['readAll', ...args])
      return { ok: true, value: { data: 'QUJD', bytes: 3, eof: true, offset: 0 } }
    },
  })
  client.apply(fake.ctx)

  const { writes, actions } = recordingActions()
  const face = fake.registrations[0].options.inject('session-1', actions)

  face.read('/tmp/shot.PNG')
  await settled()
  assert.deepEqual(calls[0].slice(0, 3), ['readAll', 'session-1', '/tmp/shot.PNG'])
  assert.deepEqual(writes[1], ['previewLoaded', '/tmp/shot.PNG', {
    kind: 'image', image: { dataUrl: 'data:image/png;base64,QUJD', size: 3 },
  }])

  // A text suffix on the same face still takes the paged read.
  face.read('/tmp/a.txt')
  await settled()
  assert.deepEqual(calls[1].slice(0, 3), ['read', 'session-1', '/tmp/a.txt'])
})

test('a glyph is reached under either name the shell\'s icon set gives it', async () => {
  const registration = await loadClientFactory()
  const icon = () => null

  /**
   * Materialize the bundle against one shell's icon set.
   *
   * The set is a proxy over the names this shell has, so every name the shim asks
   * for is recorded whether or not the set holds it — which is the whole point:
   * the pane cannot know which spelling it is talking to.
   */
  const against = (names) => {
    const probes = []
    const held = new Set(names)
    const set = new Proxy({}, {
      get: (_target, name) => {
        if (typeof name !== 'string') return undefined
        probes.push(name)
        return held.has(name) ? icon : undefined
      },
      // The bundle's module interop copies the namespace's own keys, so the set
      // has to name every glyph the shim may ask about — in both spellings.
      ownKeys: () => candidateNames,
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    })
    const shell = stubRequire()
    const client = registration.factory(
      specifier => specifier === '@deepseek-ai/dsh-client-ui-primitives' ? set : shell(specifier),
    )
    // Only the glyph under test: what the set is read for otherwise is the
    // bundle's own business, not this contract's.
    return { client, probes: probes.filter(name => name.startsWith('IconCopyOutline')) }
  }

  // Both spellings of every glyph the pane draws, so either shell's set is
  // covered by one candidate list.
  const bases = [
    'IconBrowseOutline', 'IconCheckOutline', 'IconCloseOutline', 'IconCodeOutline', 'IconCopyOutline',
    'IconDownloadOutline', 'IconFolderClose', 'IconFolderOpen', 'IconPanelLeftOutline',
    'IconRefreshOutline', 'IconRightUpOutline', 'IconStopFill',
  ]
  const candidateNames = [
    ...bases.flatMap(base => [`${base}Regular`, `${base}Medium`, `${base}16`]),
    'CodeBlock', 'FileTypeIcon', 'JsonTree', 'MarkdownText',
    'classifyFileType', 'fileSizeText', 'writeClipboard',
  ]

  // 0.2.0's set: the weight suffix wins.
  const modern = against(bases.map(base => `${base}Regular`))
  assert.equal(modern.client.shellIcon('IconCopyOutline'), icon)
  assert.deepEqual(modern.probes, ['IconCopyOutlineRegular'])

  // 0.1.5's set: the size suffix is all there is.
  const legacy = against(bases.map(base => `${base}16`))
  assert.equal(legacy.client.shellIcon('IconCopyOutline'), icon)
  assert.deepEqual(
    legacy.probes,
    ['IconCopyOutlineRegular', 'IconCopyOutlineMedium', 'IconCopyOutline16'],
  )

  // A shell that renamed the set again answers `undefined` rather than throwing,
  // which is what keeps a missing glyph from taking the whole pane down.
  const unknown = against([])
  assert.equal(unknown.client.shellIcon('IconCopyOutline'), undefined)
  assert.ok(unknown.probes.includes('IconCopyOutline16'))
})

test('a complete read follows whichever byte-read dialect the shell speaks', async () => {
  const registration = await loadClientFactory()

  /** Read one image through a face whose shell is 0.2.0's or 0.1.5's. */
  const readThrough = async (modernBytes) => {
    const calls = []
    const native = new Uint8Array([65, 66, 67])
    const client = registration.factory(stubRequire())
    const fake = fakeContext({
      modernBytes,
      list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
      read: async () => ({ ok: false, error: { code: 'workspace-file/not-text', message: 'binary' } }),
      // Both dialects answer the same file: base64 text before 0.2.0, native bytes
      // after it.
      readAll: async (...args) => {
        calls.push(['readAll', ...args])
        return {
          ok: true,
          value: { absolutePath: '/tmp/shot.PNG', version: 'v1', bytes: 3, offset: 0, data: 'QUJD', eof: true },
        }
      },
      readBytes: async (...args) => {
        calls.push(['readBytes', ...args])
        return {
          ok: true,
          value: { absolutePath: '/tmp/shot.PNG', version: 'v1', bytes: 3, offset: 0, data: native, eof: true },
        }
      },
    })
    client.apply(fake.ctx)

    const { writes, actions } = recordingActions()
    fake.registrations[0].options.inject('session-1', actions).read('/tmp/shot.PNG')
    await settled()
    return { calls, writes }
  }

  // 0.1.5: its own complete read, answered as base64.
  const legacy = await readThrough(false)
  assert.deepEqual(legacy.calls.map(call => call[0]), ['readAll'])
  assert.deepEqual(legacy.writes[1], ['previewLoaded', '/tmp/shot.PNG', {
    kind: 'image', image: { dataUrl: 'data:image/png;base64,QUJD', size: 3 },
  }])

  // 0.2.0: `readAll` is gone, so a complete read is a window read with no range at
  // all — and its bytes are used as they arrive.
  const modern = await readThrough(true)
  assert.deepEqual(modern.calls.map(call => call[0]), ['readBytes'])
  assert.deepEqual(modern.calls[0][3], {})
  assert.deepEqual(modern.writes[1], ['previewLoaded', '/tmp/shot.PNG', {
    kind: 'image', image: { dataUrl: 'data:image/png;base64,QUJD', size: 3 },
  }])
})

test('a byte window follows whichever dialect the shell speaks', async () => {
  const registration = await loadClientFactory()

  /** Download one file, recording the options each window read carried. */
  const downloadThrough = async (modernBytes) => {
    const options = []
    const native = new Uint8Array(8).fill(7)
    const client = registration.factory(stubRequire())
    // Above the size that is collected silently, so the transfer goes into the
    // reader's save dialog and needs no `document` to stand in for a page.
    const size = client.SILENT_DOWNLOAD_LIMIT + 1
    const fake = fakeContext({
      modernBytes,
      list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
      read: async () => ({ ok: false, error: { code: 'workspace-file/not-text', message: 'binary' } }),
      stat: async () => ({ ok: true, value: { absolutePath: '/w/a.bin', version: 'v1', bytes: size } }),
      readBytes: async (_session, _path, received) => {
        options.push(received)
        return {
          ok: true,
          value: {
            absolutePath: '/w/a.bin',
            version: 'v1',
            bytes: size,
            offset: 0,
            // The window's bytes in the shape this dialect sends them, and its
            // last window whatever the declared size.
            data: modernBytes ? native : Buffer.from(native).toString('base64'),
            eof: true,
          },
        }
      },
    })
    client.apply(fake.ctx)

    const store = fake.registrations[0].options.store
    const draft = store.init()
    store.actions.start(draft, '/w')
    const bound = Object.fromEntries(
      Object.entries(store.actions).map(([name, action]) => [name, (...args) => action(draft, ...args)]),
    )
    const written = []
    globalThis.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (chunk) => { written.push(chunk.length) },
        close: async () => { written.push('closed') },
        abort: async () => { written.push('aborted') },
      }),
    })
    try {
      fake.registrations[0].options.inject('session-1', bound).download('/w/a.bin', 'a.bin')
      for (let turn = 0; turn < 20 && draft.downloads[0]?.state.kind === 'running'; turn++) await settled()
    } finally {
      delete globalThis.showSaveFilePicker
    }
    assert.deepEqual(written, [8, 'closed'])
    return { options, draft, window: client.READ_WINDOW_BYTES }
  }

  // 0.1.5: the window's own fields are the options.
  const legacy = await downloadThrough(false)
  assert.deepEqual(legacy.options, [{ offset: 0, length: legacy.window }])
  assert.deepEqual(legacy.draft.downloads[0].state, { kind: 'done' })

  // 0.2.0: the same window is nested under `range`.
  const modern = await downloadThrough(true)
  assert.deepEqual(modern.options, [{ range: { offset: 0, length: modern.window } }])
  assert.deepEqual(modern.draft.downloads[0].state, { kind: 'done' })
})

test('a failed listing and a failed read report the Remote failure', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const failure = { code: 'workspace-file/not-text', message: 'not text' }
  const fake = fakeContext({
    list: async () => ({ ok: false, error: failure }),
    read: async () => ({ ok: false, error: failure }),
  })
  client.apply(fake.ctx)

  const { writes, actions } = recordingActions()
  const face = fake.registrations[0].options.inject('session-1', actions)

  face.list('/tmp')
  await settled()
  assert.deepEqual(writes[1], ['failed', '/tmp', failure])

  face.read('/tmp/a.bin')
  await settled()
  assert.deepEqual(writes[3], ['previewFailed', '/tmp/a.bin', failure])
})

/** Read a stored-entry zip, the way a reader would: through its central directory. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory: scan back for its signature (no comment is written).
  let eocd = bytes.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--
  assert.ok(eocd >= 0, 'no end of central directory record')
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const entries = []
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central directory header signature')
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const offset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    // The local header must agree with the directory, and the bytes must be there.
    assert.equal(view.getUint32(offset, true), 0x04034b50, `local header for ${name}`)
    const localNameLength = view.getUint16(offset + 26, true)
    const localExtra = view.getUint16(offset + 28, true)
    const start = offset + 30 + localNameLength + localExtra
    const data = bytes.subarray(start, start + size)
    assert.equal(data.length, size, `stored length for ${name}`)
    entries.push({ name, crc, size, data })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}

test('the zip writer writes an archive a reader can walk', async () => {
  const registration = await loadClientFactory()
  const { zip, crc32 } = registration.factory(stubRequire())

  // The standard check value for CRC-32, so the table is verifiably the right one.
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)

  const parts = [
    { name: 'a.xml', data: new TextEncoder().encode('<a/>') },
    { name: 'word/media/image1.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) },
    { name: 'empty', data: new Uint8Array(0) },
  ]
  const entries = readZip(zip(parts))
  assert.deepEqual(entries.map(entry => entry.name), ['a.xml', 'word/media/image1.png', 'empty'])
  for (const [index, entry] of entries.entries()) {
    const source = parts[index].data
    assert.equal(entry.size, source.length, entry.name)
    assert.deepEqual([...entry.data], [...source], `${entry.name} bytes`)
    // The recorded checksum is the part's own, which is what a reader verifies.
    assert.equal(entry.crc, crc32(source), `${entry.name} crc`)
  }
})

test('the PDF writer writes pages whose objects the table points at', async () => {
  const registration = await loadClientFactory()
  const { pdfFromPages } = registration.factory(stubRequire())

  const page = (byte) => ({
    // A tiny but well-formed JPEG head: the writer must not touch these bytes.
    jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, byte, byte, byte, 0xff, 0xd9]),
    width: 1240,
    height: 1754,
  })
  const bytes = pdfFromPages([page(1), page(2)])
  const text = new TextDecoder('latin1').decode(bytes)

  assert.ok(text.startsWith('%PDF-1.4'), 'header')
  assert.ok(text.endsWith('%%EOF\n'), 'trailer')
  assert.match(text, /\/Type \/Catalog/)
  assert.match(text, /\/Count 2\b/)
  // Each page is A4 wide with its image's own aspect ratio, and points at its own
  // content stream and image: page objects are 3 and 6, contents 4 and 7, images 5 and 8.
  for (const pageNumber of [3, 6]) {
    assert.ok(text.includes('/Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 '), `page ${pageNumber} box`)
    assert.ok(text.includes(`/Contents ${pageNumber + 1} 0 R`), `page ${pageNumber} content`)
    assert.ok(text.includes(`/XObject << /Im0 ${pageNumber + 2} 0 R >>`), `page ${pageNumber} image`)
  }
  // The box follows the image's aspect ratio at A4's width, rather than padding a
  // short page out to the paper's height.
  const fitted = (595.28 * (1754 / 1240)).toFixed(2)
  assert.ok(text.includes(`/MediaBox [0 0 595.28 ${fitted}]`), `fitted page box (${fitted})`)

  // Every object the cross-reference table names must start where it says.
  const startxref = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split('\n')[0])
  assert.equal(text.slice(startxref, startxref + 4), 'xref')
  const table = text.slice(startxref).split('\n')
  const declared = Number(table[1].split(' ')[1])
  assert.equal(declared, 9, 'one catalog, one page tree, three objects per page, plus the free entry')
  for (let number = 1; number < declared; number++) {
    const offset = Number(table[number + 2].slice(0, 10))
    assert.ok(text.startsWith(`${number} 0 obj`, offset), `object ${number} at ${offset}`)
  }

  // The embedded image is byte-identical: a PDF carries a JPEG through untouched.
  let from = 0
  for (const marker of [1, 2]) {
    const header = text.indexOf('/Length 9 >>', from)
    const start = text.indexOf('stream\n', header) + 'stream\n'.length
    from = start
    assert.deepEqual([...bytes.subarray(start, start + 9)], [...page(marker).jpeg], `jpeg ${marker}`)
  }
})

test('the Word writer writes an OOXML package with its parts related', async () => {
  const registration = await loadClientFactory()
  const { docxFromBlocks } = registration.factory(stubRequire())

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])
  const dataUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
  const bytes = docxFromBlocks([
    { kind: 'heading', level: 1, runs: [{ text: '标题 & 内容' }] },
    { kind: 'paragraph', runs: [{ text: 'plain ', }, { text: 'bold', bold: true }, { text: 'code', code: true }] },
    { kind: 'paragraph', runs: [{ text: 'first line\nsecond line' }] },
    { kind: 'code', text: 'a = 1\nb = 2' },
    { kind: 'list', ordered: true, depth: 0, runs: [{ text: 'first' }] },
    { kind: 'list', ordered: true, depth: 0, runs: [{ text: 'second' }] },
    { kind: 'list', ordered: false, depth: 1, runs: [{ text: 'bullet' }] },
    { kind: 'heading', level: 2, runs: [{ text: 'break' }] },
    { kind: 'list', ordered: true, depth: 0, runs: [{ text: 'restarts' }] },
    { kind: 'table', rows: [{ cells: [{ runs: [{ text: 'h1' }] }, { runs: [{ text: 'h2' }] }] }, { cells: [{ runs: [{ text: 'v1' }] }, { runs: [{ text: 'v2' }] }] }] },
    { kind: 'rule' },
    { kind: 'image', src: dataUrl, alt: '图', width: 400, height: 200 },
    { kind: 'image', src: 'https://example.com/x.png', alt: 'remote' },
  ], 'lesson.md')

  const parts = readZip(bytes).map(entry => ({
    name: entry.name,
    text: new TextDecoder().decode(entry.data),
    data: entry.data,
  }))
  const names = parts.map(part => part.name)
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'docProps/core.xml']) {
    assert.ok(names.includes(required), `missing ${required}`)
  }
  // The document must be well-formed XML, with the text escaped and the structure kept.
  const document = parts.find(part => part.name === 'word/document.xml').text
  assert.match(document, /^<\?xml version="1\.0"/)
  assert.ok(document.includes('<w:body>') && document.includes('</w:body>'))
  assert.ok(document.includes('标题 &amp; 内容'), 'text escaped, CJK intact')
  assert.ok(document.includes('<w:b/>'), 'bold run')
  // A newline inside a run is a line break; a code block is one shaded paragraph
  // per line, so its shading follows every line instead of one block of text.
  assert.ok(document.includes('<w:br/>'), 'line break inside a run')
  const shaded = document.match(/<w:shd w:val="clear" w:fill="F2F3F5"\/>(?:(?!<\/w:p>).)*<\/w:p>/g) ?? []
  assert.equal(shaded.length, 2, 'one shaded paragraph per code line')
  assert.ok(shaded[0].includes('a = 1') && shaded[1].includes('b = 2'))
  assert.ok(document.includes('<w:tbl>') && document.includes('<w:tc>'), 'table')
  assert.ok(document.includes('<w:drawing>') && document.includes('r:embed="rIdImage1"'), 'image')
  assert.ok(document.includes('<w:pBdr>'), 'horizontal rule')
  // Ordered items are numbered and an unordered one is not; a new list restarts.
  // A paragraph's text is the concatenation of its runs, which is how a reader
  // sees a marker typed as one run and the item as the next.
  const paragraphText = [...document.matchAll(/<w:p>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?([\s\S]*?)<\/w:p>/g)]
    .map(match => [...match[1].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(run => run[1]).join(''))
  assert.ok(paragraphText.includes('1.\u00a0first'), 'first ordered marker')
  assert.ok(paragraphText.includes('2.\u00a0second'), 'second ordered marker')
  assert.ok(paragraphText.includes('\u2022\u00a0bullet'), 'bullet marker')
  assert.ok(paragraphText.includes('1.\u00a0restarts'), 'numbering restarts after another block')
  const core = parts.find(part => part.name === 'docProps/core.xml').text
  assert.ok(core.includes('<dc:title>lesson.md</dc:title>'), 'title metadata')
  // Every part needs a declared content type, including the properties part.
  assert.ok(parts.find(part => part.name === '[Content_Types].xml').text
    .includes('PartName="/docProps/core.xml"'), 'core.xml content type')

  // Media: only the image that could be read is embedded, byte for byte.
  const media = parts.filter(part => part.name.startsWith('word/media/'))
  assert.equal(media.length, 1, 'one embedded image')
  assert.deepEqual([...media[0].data], [...png])
  assert.ok(parts.find(part => part.name === '[Content_Types].xml').text.includes('image/png'))
  const rels = parts.find(part => part.name === 'word/_rels/document.xml.rels').text
  assert.ok(rels.includes('Target="media/image1.png"'), 'relationship target')
  // The unreadable remote image keeps its place as alt text instead.
  assert.ok(document.includes('remote'))
})
