/** Files a viewer exports, written where the user picks or, unattended, where the host decides. */
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import * as vscode from 'vscode'

import { parseContainerUriText, splitContainer } from './container-uri.js'
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
  if (vscode.workspace.getConfiguration('modkit').get<boolean>('askExportLocation', true)) {
    return saveAs(files, beside)
  }
  if (beside !== undefined) return writeBeside(files, beside)
  const target = exportFolder()
  if (target === undefined) {
    return { state: 'refused', reason: localizer.text('vscode.export.noFolder') }
  }
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

/** This window's export folder: `modkit-export` in its first folder on disk. */
function exportFolder(): vscode.Uri | undefined {
  const folder = (vscode.workspace.workspaceFolders ?? []).find(
    candidate => candidate.uri.scheme === 'file',
  )
  return folder === undefined ? undefined : vscode.Uri.joinPath(folder.uri, VIEWER_EXPORT_FOLDER)
}

/**
 * Save As, as MK2 asked: one file names itself in a save dialog, several share a folder. The
 * dialog starts beside the source on disk (beside the archive for a member); a source it cannot
 * write into — a game's storage, a content source — starts in the export folder.
 */
async function saveAs(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  beside: string | undefined,
): Promise<
  | { readonly state: 'written'; readonly names: readonly string[] }
  | { readonly state: 'refused'; readonly reason: string }
> {
  const localizer = createVscodeLocalizer(vscode.env.language)
  const onDisk =
    beside === undefined
      ? undefined
      : (() => {
          const location = parseContainerUriText(beside)
          return location === undefined ? beside : splitContainer(location.container).file
        })()
  const start =
    onDisk !== undefined
      ? vscode.Uri.file(dirname(onDisk))
      : (exportFolder() ?? vscode.Uri.file(homedir()))
  const first = files[0]
  if (files.length === 1 && first !== undefined) {
    const chosen = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(start, first.name),
      saveLabel: localizer.text('vscode.export.save'),
      title: localizer.text('vscode.export.saveTitle', { name: first.name }),
    })
    if (chosen === undefined) {
      return { state: 'refused', reason: localizer.text('vscode.export.cancelled') }
    }
    // the dialog asked before replacing a file, so the chosen name is written as it is
    await vscode.workspace.fs.writeFile(chosen, new Uint8Array(first.bytes))
    await vscode.commands.executeCommand('vscode.open', chosen, { preview: false })
    return {
      state: 'written',
      names: Object.freeze([chosen.path.slice(chosen.path.lastIndexOf('/') + 1)]),
    }
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: start,
    openLabel: localizer.text('vscode.export.saveHere'),
    title: localizer.text('vscode.export.saveManyTitle', { count: files.length }),
  })
  const folder = picked?.[0]
  if (folder === undefined) {
    return { state: 'refused', reason: localizer.text('vscode.export.cancelled') }
  }
  const names = await writeUnique(files, folder)
  void vscode.window.showInformationMessage(
    localizer.text('vscode.export.written', { count: names.length, folder: folder.fsPath }),
  )
  return { state: 'written', names }
}

/** Write each file into `folder` under a name that replaces nothing: `x.png`, `x (2).png`… */
async function writeUnique(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  folder: vscode.Uri,
): Promise<readonly string[]> {
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
  }
  return Object.freeze(names)
}

/**
 * A conversion lands where MK2 put it: beside its source — inside the same archive for a member —
 * under a name that does not overwrite anything, and opens in a tab of its own.
 */
export async function writeBeside(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  beside: string,
): Promise<{ readonly state: 'written'; readonly names: readonly string[] }> {
  const folder = vscode.Uri.joinPath(subjectUriOf(beside), '..')
  const names = await writeUnique(files, folder)
  for (const name of names) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(folder, name), {
      preview: false,
    })
  }
  return { state: 'written', names }
}
