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

/** A fake client context recording every registration the plugin makes. */
function fakeContext({ list, read, readAll }) {
  const registrations = []
  const effects = []
  const dictionaries = []
  const styles = []
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
        readAll: readAll ?? (async () => ({ ok: false, error: { code: 'unexpected', message: 'readAll' } })),
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
    ]) {
      assert.ok(css.includes(hook), `stylesheet lost ${hook}`)
    }
    // Wrapping keeps words whole: the shared code block defaults to break-all,
    // so the override and the wrap variable are load-bearing.
    assert.match(css, /--dsl-code-block-line-white-space:\s*pre-wrap/)
    assert.match(css, /overflow-wrap:\s*break-word/)
    assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/)
    assert.doesNotMatch(css, /word-break:\s*break-all/)
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
    kind: 'image', image: { dataUrl: 'data:image/png;base64,QUJD', bytes: 3 },
  }])

  // A text suffix on the same face still takes the paged read.
  face.read('/tmp/a.txt')
  await settled()
  assert.deepEqual(calls[1].slice(0, 3), ['read', 'session-1', '/tmp/a.txt'])
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
