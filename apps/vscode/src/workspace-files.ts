/** The folders on disk this window works in. */
import * as vscode from 'vscode'

export function workspaceFolders(): readonly string[] {
  return (vscode.workspace.workspaceFolders ?? []).flatMap(folder =>
    folder.uri.scheme === 'file' ? [folder.uri.fsPath] : [],
  )
}

/**
 * `workspace.findFiles` over the folders on disk. Modkit's own folders (a mounted game storage, an
 * archive) answer VS Code's search too, but these callers mean the files of the project: its
 * language documents, a map to test on.
 */
export async function findDiskFiles(
  include: string,
  exclude: string,
  maximum: number,
): Promise<vscode.Uri[]> {
  const found: vscode.Uri[] = []
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file' || found.length >= maximum) continue
    found.push(
      ...(await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, include),
        exclude,
        maximum - found.length,
      )),
    )
  }
  return found
}
