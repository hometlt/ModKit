/** The subject a VS Code URI names, and back: files, container members, content sources. */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { type ModContextTarget } from '@modkit/vfs/content-sources'

import {
  containerUriPath,
  containerUriText,
  CONTAINER_SCHEME,
  parseContainerUriPath,
  parseContainerUriText,
  splitContainer,
} from './container-uri.js'
import type { TreeNodeFacts } from '@modkit/sdk'
import { type VsCodeSubjectCandidateScope } from './subject-candidates.js'

/**
 * The subject string a URI names.
 *
 * A `file:` URI names a path; a `modkit-container:` URI names a member of an open container and has
 * no meaningful `fsPath` at all — its own text *is* the identity, and handing `fsPath` to anything
 * downstream would silently address a file that does not exist.
 */
export function subjectPathOf(uri: vscode.Uri): string {
  if (uri.scheme === CONTAINER_SCHEME) return `${CONTAINER_SCHEME}:${uri.path}`
  return uri.scheme === 'modkit-source' ? uri.toString() : uri.fsPath
}

/**
 * Where the content sources open a subject path: a `modkit-source:` URI is a path inside one of
 * them, a member of a container — nested or not — is the container's path joined with every member
 * on the way (the loader opens a packed package or the game's storage it lands in, and anything
 * else inside its base mods), anything else is a host path.
 */
export function modContextTargetOf(path: string): ModContextTarget | undefined {
  if (path.startsWith('modkit-source:')) {
    const uri = vscode.Uri.parse(path)
    const [sourceId, ...parts] = uri.path.replace(/^\//u, '').split('/')
    return uri.authority === 'battlenet' && sourceId
      ? Object.freeze({ sourceId, path: parts.filter(Boolean).join('/') })
      : undefined
  }
  const location = parseContainerUriText(path)
  if (location === undefined) return path
  const { file, members } = splitContainer(location.container)
  return [file.replace(/[\\/]+$/u, ''), ...members, location.entry].filter(Boolean).join('/')
}

/** The inverse: the URI a subject string names, for the editor surfaces that take one. */
export function subjectUriOf(path: string): vscode.Uri {
  if (path.startsWith('modkit-source:')) return vscode.Uri.parse(path)
  const location = parseContainerUriText(path)
  return location === undefined
    ? vscode.Uri.file(path)
    : vscode.Uri.from({
        scheme: CONTAINER_SCHEME,
        path: containerUriPath(location.container, location.entry),
      })
}

/**
 * The entry a namespace-entry subject id names, or nothing when the subject is not one.
 *
 * Codecs address an entry inside their own package as `<package source uri>?vfs-path=<entry>`; the
 * package part is the codec's source uri, which is not this window's subject string, so only the
 * entry travels — the caller already knows which package it asked.
 */
export function namespaceEntryPathOf(subjectId: string): string | undefined {
  const match = /[?&]vfs-path=([^&]*)$/u.exec(subjectId)
  if (match?.[1] === undefined) return undefined
  try {
    const entry = decodeURIComponent(match[1]).replaceAll('\\', '/').replace(/^\/+/u, '')
    return entry === '' || entry.split('/').includes('..') ? undefined : entry
  } catch {
    return undefined
  }
}

/**
 * The package a namespace-entry subject belongs to, when its own address names one.
 *
 * With a dependency chain on screen the resource under the cursor usually belongs to a *lower*
 * layer — an alert declared by Core, read while editing Void. Both packages carry a file of the
 * same name, so resolving the entry against the active package opens the wrong document at a line
 * that means nothing. The subject id already carries its package; this reads it back.
 */
export function namespaceEntryRootOf(subjectId: string): string | undefined {
  const cut = subjectId.search(/[?&]vfs-path=/u)
  if (cut <= 0) return undefined
  const head = subjectId.slice(0, cut)
  if (parseContainerUriText(head) !== undefined || head.startsWith('modkit-source:')) return head
  if (!head.startsWith('file:')) return undefined
  try {
    return vscode.Uri.parse(head, true).fsPath
  } catch {
    return undefined
  }
}

/** The URI of one entry inside a package subject, for a directory package or a container member. */
export function memberUriOf(root: string, entry: string): vscode.Uri {
  if (root.startsWith('modkit-source:')) {
    return vscode.Uri.joinPath(vscode.Uri.parse(root), ...entry.split('/'))
  }
  const location = parseContainerUriText(root)
  if (location === undefined) {
    const filesystemRoot = root.startsWith('file:') ? vscode.Uri.parse(root).fsPath : root
    // A packed mod's resource address carries the package file as its root.
    try {
      if (statSync(filesystemRoot).isFile())
        return subjectUriOf(containerUriText(filesystemRoot, entry))
    } catch {
      /* A directory or an unavailable source still uses the ordinary file route. */
    }
    return vscode.Uri.file(join(filesystemRoot, entry))
  }
  return subjectUriOf(
    containerUriText(
      location.container,
      location.entry === '' ? entry : `${location.entry}/${entry}`,
    ),
  )
}

/**
 * Show a resource file, at its declaration when one is known.
 *
 * A file already on screen is revealed where it is: opening it «beside» a second time would split
 * the window once per click and leave the reader hunting for the copy that moved.
 */
export async function openResourceFile(
  target: vscode.Uri,
  range?: TreeNodeFacts['range'],
): Promise<void> {
  const open = vscode.window.tabGroups.all
    .flatMap(group => group.tabs.map(tab => ({ group, tab })))
    .find(
      ({ tab }) =>
        (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) &&
        tab.input.uri.toString() === target.toString(),
    )
  const line = range === undefined ? undefined : (range as { line?: number }).line
  const column = range === undefined ? undefined : (range as { column?: number }).column
  const at =
    typeof line === 'number' && typeof column === 'number'
      ? new vscode.Range(new vscode.Position(line, column), new vscode.Position(line, column))
      : undefined
  await vscode.commands.executeCommand('vscode.open', target, {
    viewColumn: open?.group.viewColumn ?? vscode.ViewColumn.Beside,
    preview: false,
    ...(at === undefined ? {} : { selection: at }),
  })
}

export function subjectCandidateScopeOf(uri: vscode.Uri): VsCodeSubjectCandidateScope {
  const container = uri.scheme === CONTAINER_SCHEME ? parseContainerUriPath(uri.path) : undefined
  const workspaceTarget = container === undefined ? uri : vscode.Uri.file(container.container)
  const workspaceUri = vscode.workspace.getWorkspaceFolder(workspaceTarget)?.uri.toString()
  return Object.freeze({
    uri: uri.toString(),
    ...(workspaceUri === undefined ? {} : { workspaceUri }),
    ...(container === undefined
      ? {}
      : { containerUri: vscode.Uri.file(container.container).toString() }),
  })
}
