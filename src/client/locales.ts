/**
 * `fileExplorer` namespace dictionaries, and the namespace declaration.
 *
 * The failure lines name what the tree could not list, one code each, because a
 * directory that is gone, one outside the workspace, and a path that is not a
 * directory each suggest a different next step. The preview lines do the same
 * for the read failures a viewer can meet: not text, too large, not a regular
 * file.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'fileExplorer'>` or `PropsLocale<'fileExplorer'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'fileExplorer'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** View tab label, tree states, and preview states. */
    fileExplorer: FileExplorerKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'view.files': '文件',
  'tree.root': '工作区',
  'tree.reload': '重新读取',
  'tree.loading': '正在读取…',
  'tree.empty': '空目录',
  'tree.truncated': '条目过多，只显示了一部分。',
  'tree.noWorkspace': '这个会话没有工作区目录。',
  'tree.other': '既不是文件也不是目录，无法打开。',
  'tree.error.notFound': '目录不存在，可能已被移动或删除。',
  'tree.error.outsideWorkspace': '该目录在工作区之外，无法读取。',
  'tree.error.notDirectory': '这不是一个目录。',
  'tree.error.unavailable': '读取失败：{message}',
  'preview.placeholder': '从左侧选择一个文件进行预览。',
  'preview.empty': '空文件',
  'preview.rendered': '预览',
  'preview.source': '源码',
  'preview.jsonLabel': 'JSON 文档',
  'preview.jsonInvalid': '这不是可展开的 JSON，已显示源码。',
  'code.copy': '复制',
  'code.copied': '已复制',
  'footnotes': '脚注',
  'json.copyValue': '复制值',
  'json.copyJson': '复制 JSON',
  'json.copyPath': '复制路径',
  'json.copyPrettyJson': '复制格式化 JSON',
  'json.copyCompactJson': '复制压缩 JSON',
  'json.copied': '已复制',
  'json.copyFailed': '复制失败',
  'json.collapseNode': '收起',
  'json.expandNode': '展开',
  'json.copyTitle': '{action}',
  'preview.title': '预览',
  'preview.loading': '正在读取…',
  'preview.reload': '重新读取',
  'preview.truncated': '文件较长，只显示前 {lines} 行。',
  'preview.wrap': '自动换行',
  'preview.nowrap': '不换行',
  'preview.lines': '{lines} 行',
  'preview.error.notFound': '文件不存在，可能已被移动或删除。',
  'preview.error.notText': '这不是可以预览的文本文件。',
  'preview.error.tooLarge': '文件太大，无法预览。',
  'preview.error.notRegularFile': '这不是一个普通文件。',
  'preview.error.unavailable': '预览失败：{message}',
} satisfies Record<string, string>

/** Files dictionary key union. */
export type FileExplorerKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'view.files': 'Files',
  'tree.root': 'Workspace',
  'tree.reload': 'Reload',
  'tree.loading': 'Reading…',
  'tree.empty': 'Empty directory',
  'tree.truncated': 'Too many entries, showing only some of them.',
  'tree.noWorkspace': 'This session has no workspace directory.',
  'tree.other': 'Not a file or a directory, so it cannot be opened.',
  'tree.error.notFound': 'That directory is gone. It may have been moved or deleted.',
  'tree.error.outsideWorkspace': 'That directory is outside the workspace, so it cannot be read.',
  'tree.error.notDirectory': 'That is not a directory.',
  'tree.error.unavailable': 'Read failed: {message}',
  'preview.placeholder': 'Pick a file on the left to preview it.',
  'preview.empty': 'Empty file',
  'preview.rendered': 'Rendered',
  'preview.source': 'Source',
  'preview.jsonLabel': 'JSON document',
  'preview.jsonInvalid': 'That is not JSON a tree can walk, so the source is shown.',
  'code.copy': 'Copy',
  'code.copied': 'Copied',
  'footnotes': 'Footnotes',
  'json.copyValue': 'Copy value',
  'json.copyJson': 'Copy JSON',
  'json.copyPath': 'Copy path',
  'json.copyPrettyJson': 'Copy pretty JSON',
  'json.copyCompactJson': 'Copy compact JSON',
  'json.copied': 'Copied',
  'json.copyFailed': 'Copy failed',
  'json.collapseNode': 'Collapse',
  'json.expandNode': 'Expand',
  'json.copyTitle': '{action}',
  'preview.title': 'Preview',
  'preview.loading': 'Reading…',
  'preview.reload': 'Reload',
  'preview.truncated': 'This file is long, showing the first {lines} lines.',
  'preview.wrap': 'Wrap long lines',
  'preview.nowrap': 'Do not wrap long lines',
  'preview.lines': '{lines} lines',
  'preview.error.notFound': 'That file is gone. It may have been moved or deleted.',
  'preview.error.notText': 'That is not a text file this preview can show.',
  'preview.error.tooLarge': 'That file is too large to preview.',
  'preview.error.notRegularFile': 'That is not a regular file.',
  'preview.error.unavailable': 'Preview failed: {message}',
} satisfies Record<FileExplorerKey, string>
