/**
 * Browser half: register `files` as one Conversation View.
 *
 * The public path, unmodified: the view into the `conversation.view` list slot
 * that `@deepseek-ai/dsh-client-ui-conversation` owns and renders as the tab
 * strip beside Chat and Trajectory. The registration carries the exclusive
 * per-Session store, the injected Remote face, and the locale namespace; the
 * slot service's effect wrapper means plugin unload removes the tab, its
 * dictionary, and its stylesheet, and disposal of the declaration removes the
 * contribution again if the Conversation shell is remounted.
 *
 * The file split is this package's layering: what the explorer keeps
 * (`store.ts`), how it lists and reads (`face.ts`), what it draws
 * (`FilesView.tsx`), what it looks like (`styles.ts`), what it says
 * (`locales.ts`), and this module, which only wires them together.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the Client Remote face (`ctx.remote`).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale service's Context merge (`ctx.locale`).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row and the owner props the view
// component derives must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the slot service's Context merge (`ctx.slots`).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { FilesView } from './FilesView.tsx'
import { filesFace } from './face.ts'
import type { FilesInjected } from './face.ts'
import { en, NS, zh } from './locales.ts'
import { createFilesStore } from './store.ts'
import { installStyles } from './styles.ts'

export { parseJsonDocument, previewLines, tabLabels } from './FilesView.tsx'
export { canExportPdf, extensionOf, hasSourceToggle, previewFormatFor } from './format.ts'
export type { PreviewFormat, PreviewFormatKind } from './format.ts'
export type { FileExplorerKey } from './locales.ts'
export { RETAINED_PREVIEWS } from './store.ts'
export type {
  DirLevel, FilesState, LevelState, PreviewContent, PreviewImage, PreviewMode, PreviewState,
  PreviewText,
} from './store.ts'
export type { FilesInjected, WorkspaceFilesRemote } from './face.ts'
export type { FilesViewProps } from './FilesView.tsx'

/** This plugin's identity inside the browser plugin tree. */
export const name = 'file-explorer'

/**
 * Required browser services: the slot registry, copy, and the Remote carrier
 * with the workspace-files namespace the explorer reads through.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles']

/**
 * The view's id inside `conversation.view`. It is the tab's identity, the key
 * a stored View preference names, and the entry id the header selects by.
 */
export const FILES_VIEW_ID = 'files'

/**
 * Client plugin body: register the stylesheet, the dictionaries, and the view.
 * @param ctx - client root context carrying the slot registry, copy, and Remote face.
 */
export function apply(ctx: Context): void {
  ctx.effect(installStyles, '@jaxzhou/dsh-file-explorer: stylesheet')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), '@jaxzhou/dsh-file-explorer: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  const store = createFilesStore()
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, '@jaxzhou/dsh-file-explorer: request lifetime')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: FILES_VIEW_ID,
    // After Chat (default) and Trajectory (10), so the strip reads
    // Chat | Trajectory | Files.
    order: 20,
    locale: NS,
    label: () => t('view.files'),
    store,
    inject: (
      sessionId: SessionId,
      actions: BoundActions<ReturnType<typeof createFilesStore>>,
    ): FilesInjected => filesFace(ctx.remote, sessionId, lifetime.signal, actions),
  }, FilesView))
}
