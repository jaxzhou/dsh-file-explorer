/**
 * Host half of the `@jaxzhou/dsh-file-explorer` plugin.
 *
 * The plugin is browser-only. Its file tree and preview read through the
 * `workspaceFiles` Remote namespace that the Web composition already mounts
 * (`@deepseek-ai/dsh-api-workspace-files`), so the Host side publishes no
 * service, tool, prompt section, or event — it exists to give the package a
 * Loader row and to publish the `dsh.client` declaration in `package.json`
 * that makes the client module system serve `lib/client.js`.
 */

/** This plugin's identity inside the Host Loader. */
export const name = 'file-explorer'

/** No Host-side behavior. */
export function apply(): void {}
