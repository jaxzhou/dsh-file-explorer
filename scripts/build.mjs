/**
 * Build the two runtime artifacts this plugin ships.
 *
 * `lib/index.js` is the Host half: plain ESM, every dependency external (it has
 * none today).
 *
 * `lib/client.js` is the browser half. The dsh Web loader fetches it as a
 * classic script and requires a lazy CommonJS factory handoff:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *
 * so the build emits one CJS bundle wrapped in that call. Only specifiers the
 * shell's frozen module table answers may stay external; everything else is
 * inlined. TypeScript types are erased before this step, so `import type` of a
 * dsh package never becomes a runtime request.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package name; also the module id stamped into the loader handoff. */
const ID = '@jaxzhou/dsh-file-explorer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The shell's frozen module table (`PLATFORM_MODULES` in
 * `@deepseek-ai/dsh-client-web`). Every one of these is shared into the browser
 * by the shell, so each stays a `require` the factory resolves at runtime.
 * Anything outside this list must be inlined: the table cannot answer it, and a
 * bare `require` would throw while the plugin materializes.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** esbuild defines mirroring the monorepo's client bundle environment. */
const DEFINES = {
  'process.env.NODE_ENV': '"production"',
  'import.meta.env.MODE': '"production"',
  'import.meta.env': '{"MODE":"production"}',
}

async function buildHost() {
  await build({
    absWorkingDir: root,
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    packages: 'external',
    logLevel: 'info',
  })
}

async function buildClient() {
  await build({
    absWorkingDir: root,
    entryPoints: ['src/client/index.ts'],
    outfile: 'lib/client.js',
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    external: PLATFORM_MODULES,
    define: DEFINES,
    logLevel: 'info',
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`
        + '\nvar module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  })
}

/** Fail the build when an artifact lost the shape the loader requires. */
async function verify() {
  const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  const problems = []
  if (!client.includes('window.__ModuleLoader__.load(')) problems.push('missing loader handoff')
  if (!client.includes(JSON.stringify(ID))) problems.push(`missing id ${ID}`)
  if (!client.includes('return module.exports; } });')) problems.push('missing factory return')
  for (const specifier of PLATFORM_MODULES) {
    // A module-table row that got inlined is a duplicate runtime instance.
    if (!client.includes(`require("${specifier}")`) && client.includes(`from"${specifier}"`)) {
      problems.push(`platform module ${specifier} looks inlined`)
    }
  }
  const host = await readFile(resolve(root, 'lib/index.js'), 'utf8')
  if (!/export\s*\{/.test(host) || !host.includes('apply')) problems.push('host half exports no apply')
  if (problems.length > 0) throw new Error(`build verification failed: ${problems.join(', ')}`)
  await writeFile(resolve(root, 'lib/client.js'), client)
}

await mkdir(resolve(root, 'lib'), { recursive: true })
await buildHost()
await buildClient()
await verify()
console.log(`[${ID}] built lib/index.js and lib/client.js`)
