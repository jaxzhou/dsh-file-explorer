/**
 * Contract tests for the built artifacts, run with `node --test`.
 *
 * The browser bundle is a loader factory, not a module: materializing it needs
 * a `window.__ModuleLoader__` facade plus the shell's shared module table. This
 * file supplies both with stubs and then asserts what the plugin actually
 * registers — the view id and order, the exclusive store, the injected face's
 * Remote calls, and the stylesheet — so a regression in the wiring fails here
 * instead of only in a browser.
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

test('the host half is a Loader module with an inert apply', async () => {
  const module = await import(resolve(root, 'lib/index.js'))
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.apply(), undefined)
})

test('the client bundle materializes and registers one Files Conversation View', async () => {
  const registration = await loadClientFactory()
  assert.equal(registration.id, 'dsh-file-explorer')
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
    // The format bodies hang off these hooks; a rename would silently drop a
    // whole display mode.
    for (const hook of ['.dsh-fe-source', '.dsh-fe-prose', '.dsh-fe-json', '.dsh-fe-image']) {
      assert.ok(css.includes(hook), `stylesheet lost ${hook}`)
    }
    // Wrapping keeps words whole: the shared code block defaults to break-all,
    // so the override and the wrap variable are load-bearing.
    assert.match(css, /--dsl-code-block-line-white-space:\s*pre-wrap/)
    assert.match(css, /overflow-wrap:\s*break-word/)
    assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/)
    assert.doesNotMatch(css, /word-break:\s*break-all/)
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
  const { previewFormatFor, hasSourceToggle, extensionOf } = registration.factory(stubRequire())
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

  assert.equal(hasSourceToggle(previewFormatFor('/a/README.md')), true)
  assert.equal(hasSourceToggle(previewFormatFor('/a/package.json')), true)
  assert.equal(hasSourceToggle(previewFormatFor('/a/main.ts')), false)
  assert.equal(hasSourceToggle(previewFormatFor('/a/logo.png')), false)
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

test('the injected face lists directories and reads previews through Remote', async () => {
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

  const writes = []
  const actions = new Proxy({}, {
    get: (_target, name) => (...args) => { writes.push([String(name), ...args]) },
  })
  const face = fake.registrations[0].options.inject('session-1', actions)

  face.list('/tmp')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls[0].slice(0, 3), ['list', 'session-1', '/tmp'])
  assert.deepEqual(writes[0], ['loading', '/tmp'])
  assert.deepEqual(writes[1], ['loaded', '/tmp', { entries: [{ name: 'a', type: 'file' }], truncated: false }])

  face.read('/tmp/a.txt')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls[1].slice(0, 3), ['read', 'session-1', '/tmp/a.txt'])
  assert.deepEqual(calls[1][3], { offset: 1, limit: 2000 })
  assert.deepEqual(writes[2], ['selecting', '/tmp/a.txt'])
  assert.deepEqual(writes[3], ['previewLoaded', '/tmp/a.txt', {
    kind: 'text', page: { text: 'hello', lines: 1, eof: true, bytes: 5 },
  }])
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

  const writes = []
  const actions = new Proxy({}, {
    get: (_target, name) => (...args) => { writes.push([String(name), ...args]) },
  })
  const face = fake.registrations[0].options.inject('session-1', actions)

  face.read('/tmp/shot.PNG')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls[0].slice(0, 3), ['readAll', 'session-1', '/tmp/shot.PNG'])
  assert.deepEqual(writes[1], ['previewLoaded', '/tmp/shot.PNG', {
    kind: 'image', image: { dataUrl: 'data:image/png;base64,QUJD', bytes: 3 },
  }])

  // A text suffix on the same face still takes the paged read.
  face.read('/tmp/a.txt')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls[1].slice(0, 3), ['read', 'session-1', '/tmp/a.txt'])
})

test('a failed listing and a failed preview report the Remote failure', async () => {
  const registration = await loadClientFactory()
  const client = registration.factory(stubRequire())
  const failure = { code: 'workspace-file/not-text', message: 'not text' }
  const fake = fakeContext({
    list: async () => ({ ok: false, error: failure }),
    read: async () => ({ ok: false, error: failure }),
  })
  client.apply(fake.ctx)

  const writes = []
  const actions = new Proxy({}, {
    get: (_target, name) => (...args) => { writes.push([String(name), ...args]) },
  })
  const face = fake.registrations[0].options.inject('session-1', actions)

  face.list('/tmp')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes[1], ['failed', '/tmp', failure])

  face.read('/tmp/a.bin')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes[3], ['previewFailed', '/tmp/a.bin', failure])
})
