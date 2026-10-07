/**
 * The parts of the shell this plugin has to ask for by more than one name.
 *
 * Two of them changed under the plugin between harness 0.1.5 and 0.2.0, and a
 * plugin does not get to choose the shell it is loaded into — the reader's profile
 * decides. Neither change can be waited out and neither costs more than asking
 * twice:
 *
 * - **The icon set was renamed** from a size suffix to a weight suffix: a glyph
 *   that was `IconCopyOutline16` is `IconCopyOutlineRegular` (or `…Medium`, its
 *   1.3px stroke). Nothing about the component changed, only its name, so a base
 *   name is enough to reach either spelling.
 * - **A byte read changed shape.** `readAll` is gone; a window is now
 *   `{ range: { offset, length } }` where it used to be `{ offset, length }`
 *   itself; a *complete* read is the same call with no range at all; and the
 *   bytes come back native rather than base64.
 *
 * Both are answered by asking for what this shell has rather than for what the
 * plugin was built against, so one artifact serves either version.
 *
 * This module also owns the plugin's own structural view of the `workspaceFiles`
 * Remote namespace, for the same reason: the generated `ClientRemote` map is
 * assembled from whichever `…/remote` contributions the running shell installed,
 * so naming it here keeps the plugin's typecheck independent of the shell's
 * assembly — the pattern the workspace-files package itself uses.
 */
import type { ComponentType } from 'react'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorkspaceDirectoryListing, WorkspaceFileRange,
  WorkspaceFileStat, WorkspaceFileText,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { bytesOfBase64 } from './download.ts'

/**
 * A settled Remote call, as both dialects answer one.
 *
 * Declared here rather than imported from the protocol package: it is the shape
 * of the answer the calls below actually read, and the plugin depends on those
 * four fields, not on the carrier's full definition.
 */
export type RemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: RemoteFailure }

/** One byte read's answer, in either shape: base64 before 0.2.0, bytes after it. */
export interface RemoteBytes {
  /** The window's bytes, as this shell sends them. */
  readonly data: string | Uint8Array
  /** Whether the window includes the file's last byte. */
  readonly eof: boolean
  /** Complete file size, when the backend reports one. */
  readonly bytes?: number
}

/** A byte read's settled result. */
export type RemoteBytesResult = RemoteResult<RemoteBytes>

/**
 * The `workspaceFiles` namespace as this plugin calls it.
 *
 * `readAll` is optional because 0.2.0 removed it, and `readBytes`' window options
 * are typed `unknown` because their shape is exactly what changed: each call site
 * below passes the shape its dialect wants.
 */
export interface WorkspaceFilesNamespace {
  list: (
    sessionId: SessionId,
    path: string,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceDirectoryListing>>
  read: (
    sessionId: SessionId,
    path: string,
    range: WorkspaceFileRange,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileText>>
  readBytes: (
    sessionId: SessionId,
    path: string,
    options: unknown,
    signal?: AbortSignal,
  ) => Promise<RemoteBytesResult>
  stat: (
    sessionId: SessionId,
    path: string,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileStat>>
  /** Pre-0.2.0's complete read; absent from 0.2.0, where an absent range means the same thing. */
  readAll?: (
    sessionId: SessionId,
    path: string,
    signal?: AbortSignal,
  ) => Promise<RemoteBytesResult>
}

/** The slice of the Client Remote face this plugin calls. */
export interface WorkspaceFilesRemote {
  /** The `workspaceFiles` namespace. */
  readonly workspaceFiles: WorkspaceFilesNamespace
}

/**
 * One glyph from the shell's icon set, by the name it has in either dialect.
 *
 * The set spells one glyph `<base>Regular`/`<base>Medium` from 0.2.0 on and
 * `<base>16` before it, so a base name resolves under either. `Regular` is tried
 * first: it is the one-pixel stroke the set draws by default, and the glyphs this
 * pane used were the 16px outline ones.
 * @param base - the glyph's name without its weight or size suffix.
 * @param extra - further full names to try, for a glyph whose old name did not
 * follow the suffix rule.
 * @returns the component, or undefined when this shell has none of them.
 */
export function shellIcon(
  base: string,
  ...extra: readonly string[]
): ComponentType<IconProps> | undefined {
  const set = primitives as unknown as Record<string, ComponentType<IconProps> | undefined>
  for (const name of [`${base}Regular`, `${base}Medium`, `${base}16`, ...extra]) {
    const icon = set[name]
    if (typeof icon === 'function') return icon
  }
  return undefined
}

/**
 * The byte reads of one Remote face.
 * @param remote - the client Remote face.
 * @returns the namespace, at the shape this plugin calls it.
 */
function byteReads(remote: WorkspaceFilesRemote): WorkspaceFilesNamespace {
  return remote.workspaceFiles
}

/**
 * Whether this shell still carries `readAll`, which is what its removal keys on.
 *
 * Cheaper and more certain than probing a read: the method is either there or it
 * is not, and everything else about the two dialects follows from which.
 * @param remote - the client Remote face.
 * @returns whether the Host speaks the pre-0.2.0 dialect.
 */
export function readsWholeFiles(remote: WorkspaceFilesRemote): boolean {
  return typeof byteReads(remote).readAll === 'function'
}

/**
 * Read a complete file, whichever way this shell spells that.
 * @param remote - the client Remote face.
 * @param sessionId - the Session whose workspace root authorizes the read.
 * @param path - absolute file path.
 * @param signal - the request's lifetime.
 * @returns the read's settled result.
 */
export function readWholeFile(
  remote: WorkspaceFilesRemote,
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
): Promise<RemoteBytesResult> {
  const namespace = byteReads(remote)
  // 0.2.0 answers a complete read with no range where it used to have its own
  // method.
  return namespace.readAll === undefined
    ? namespace.readBytes(sessionId, path, {}, signal)
    : namespace.readAll(sessionId, path, signal)
}

/**
 * Read one byte window of a file, whichever way this shell spells that.
 * @param remote - the client Remote face.
 * @param sessionId - the Session whose workspace root authorizes the read.
 * @param path - absolute file path.
 * @param offset - first byte of the window.
 * @param length - how many bytes to ask for.
 * @param signal - the request's lifetime.
 * @returns the read's settled result.
 */
export function readFileWindow(
  remote: WorkspaceFilesRemote,
  sessionId: SessionId,
  path: string,
  offset: number,
  length: number,
  signal: AbortSignal,
): Promise<RemoteBytesResult> {
  const namespace = byteReads(remote)
  // Before 0.2.0 the window's own fields *were* the options; after it they are
  // nested under `range`.
  const options = namespace.readAll === undefined ? { range: { offset, length } } : { offset, length }
  return namespace.readBytes(sessionId, path, options, signal)
}

/**
 * The bytes one read answered with.
 * @param data - the answer's `data`, in either shape.
 * @returns the bytes.
 */
export function bytesOfRead(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? bytesOfBase64(data) : data
}
