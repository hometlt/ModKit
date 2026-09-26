/** Files a viewer exports, written where the extension host decides. */
import * as vscode from 'vscode'

import { createVscodeLocalizer } from './localization.js'
import { subjectUriOf } from './subject-uris.js'

/** Where viewer exports land: one deterministic folder per window, never a page-supplied path. */
export const VIEWER_EXPORT_FOLDER = 'modkit-export'

/**
 * Write viewer-produced export files into this window's export folder.
 *
 * The destination is derived here and nowhere else — the page sends leaf names and bytes, never a
 * location — and a window with no writable folder refuses by saying so rather than choosing a
 * directory on the user's behalf.
 */
export async function exportViewerFiles(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  beside?: string,
): Promise<
  | { readonly state: 'written'; readonly names: readonly string[] }
  | {
      readonly state: 'refused'
      readonly reason: string
    }
> {
  const localizer = createVscodeLocalizer(vscode.env.language)
  if (beside !== undefined) return writeBeside(files, beside)
  const folder = (vscode.workspace.workspaceFolders ?? []).find(
    candidate => candidate.uri.scheme === 'file',
  )
  if (folder === undefined) {
    return { state: 'refused', reason: localizer.text('vscode.export.noFolder') }
  }
  const target = vscode.Uri.joinPath(folder.uri, VIEWER_EXPORT_FOLDER)
  await vscode.workspace.fs.createDirectory(target)
  const names: string[] = []
  for (const file of files) {
    const destination = vscode.Uri.joinPath(target, file.name)
    // `workspace.fs.writeFile` is typed `Uint8Array`; a Buffer subclass is rejected by the wire.
    await vscode.workspace.fs.writeFile(destination, new Uint8Array(file.bytes))
    names.push(file.name)
  }
  void vscode.window.showInformationMessage(
    localizer.text('vscode.export.written', { count: names.length, folder: target.fsPath }),
  )
  return { state: 'written', names: Object.freeze(names) }
}

/**
 * A conversion lands where MK2 put it: beside its source — inside the same archive for a member —
 * under a name that does not overwrite anything, and opens in a tab of its own.
 */
export async function writeBeside(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  beside: string,
): Promise<{ readonly state: 'written'; readonly names: readonly string[] }> {
  const source = subjectUriOf(beside)
  const folder = vscode.Uri.joinPath(source, '..')
  const exists = (uri: vscode.Uri): Thenable<boolean> =>
    vscode.workspace.fs.stat(uri).then(
      () => true,
      () => false,
    )
  const names: string[] = []
  for (const file of files) {
    const dot = file.name.indexOf('.')
    const stem = dot < 0 ? file.name : file.name.slice(0, dot)
    const rest = dot < 0 ? '' : file.name.slice(dot)
    let destination = vscode.Uri.joinPath(folder, file.name)
    for (let copy = 2; await exists(destination); copy += 1) {
      destination = vscode.Uri.joinPath(folder, `${stem} (${copy})${rest}`)
    }
    await vscode.workspace.fs.writeFile(destination, new Uint8Array(file.bytes))
    names.push(destination.path.slice(destination.path.lastIndexOf('/') + 1))
    await vscode.commands.executeCommand('vscode.open', destination, { preview: false })
  }
  return { state: 'written', names: Object.freeze(names) }
}
