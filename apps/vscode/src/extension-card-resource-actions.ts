/**
 * The small VS Code-only edge of extension-card source/license opening.
 *
 * The host has already matched a webview request to an authority-bearing
 * `ExtensionCardResourceTarget`. This adapter nevertheless validates the target a second time:
 * `openExternal` is only for HTTP(S), folders are revealed, and license files are opened in the
 * editor. Keeping this structural makes the editor API seam unit-testable without launching VS
 * Code.
 */
import { isAbsolute } from 'node:path'

import type { ExtensionCardResourceTarget } from './extension-cards.js'

export interface VsCodeResourceUriFactory {
  file(path: string): unknown
  parse(value: string, strict?: boolean): unknown
}

export interface VsCodeResourceActions {
  readonly Uri: VsCodeResourceUriFactory
  readonly env: { openExternal(uri: unknown): PromiseLike<boolean> }
  readonly commands: { executeCommand(command: string, ...rest: unknown[]): PromiseLike<unknown> }
}

export function isSafeExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

/**
 * Open one resource that the host selected from its authoritative registry.
 *
 * This function intentionally accepts no webview input. Any string coming from the page is
 * checked before this call, so visible display text cannot be substituted as a path or URL.
 */
export async function openVsCodeExtensionCardResource(
  vscode: VsCodeResourceActions,
  resource: ExtensionCardResourceTarget,
): Promise<void> {
  if (resource.kind === 'url') {
    if (!isSafeExternalHttpUrl(resource.target)) {
      throw new Error('extension card resource is not a valid HTTP(S) URL')
    }
    await vscode.env.openExternal(vscode.Uri.parse(resource.target, true))
    return
  }
  if (!isAbsolute(resource.target)) {
    throw new Error('extension card resource is not an absolute local path')
  }
  const uri = vscode.Uri.file(resource.target)
  if (resource.kind === 'folder') {
    await vscode.commands.executeCommand('revealInExplorer', uri)
    return
  }
  await vscode.commands.executeCommand('vscode.open', uri)
}
