# @jaxzhou/dsh-file-explorer — contributor notes

## DeepSeek Harness plugin development

Before changing plugin code, read <https://dsh.pub/develop-plugin.md>
completely. Follow the pinned runtime contract and verification boundaries
there; this repository's own build and verification rules below remain
authoritative.

## Rules for this repository

- **The extension point is inspected, never guessed.** The plugin contributes
  through the `conversation.view` list slot declared by
  `@deepseek-ai/dsh-client-ui-conversation`. Confirm the key, cardinality, scope,
  owner props, and required services against the target Harness version before
  changing the registration; a slot is a typed runtime contract, not a DOM
  selector.
- **Runtime imports are module-table imports.** The browser bundle may import
  values only from the shell's frozen module table (`react`,
  `react/jsx-runtime`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`,
  `@deepseek-ai/dsh-client-ui-dockkit`). Every other dsh package is a
  `import type` and is erased at build time. Adding a runtime import of another
  dsh package requires declaring it under `dsh.client.external` AND a client row
  that can answer it; prefer collaborating through Cordis services.
- **Build before committing.** `npm run check` runs the typecheck, both artifact
  builds, the artifact-shape verification inside `scripts/build.mjs`, and the
  contract tests. `lib/` is committed output: never hand-edit it.
- **State ownership.** Durable or privileged data stays in the Host. The browser
  keeps only view state, in the declared exclusive per-session store.
- **No silent failures.** Every Remote failure branch renders a line naming what
  failed; never swallow an error or show stale content as fresh.
- **Cleanup rides effects.** Registrations, the stylesheet, dictionaries, and
  the request-lifetime abort all go through `ctx.effect` or `ctx.slots.inject`,
  so unloading the plugin removes every contribution.
