/**
 * An archive as MK2 showed it: the members as a folder tree in the render area, the archive's facts
 * in the sidebar, and a member opened as a document of its own.
 *
 * The same media shell every viewer uses. A container lists its members flat — a path per entry,
 * folders often implied rather than stored — so the tree is built here from the paths, which is
 * also what lets a folder the archive never recorded still expand.
 */
import type {
  AnyDescriptor,
  MetadataGroup,
  NamespaceEntry,
  NamespaceEntrySource,
  ViewerModule,
} from '@modkit/sdk'
import { icon } from '../icons/index.js'
import { setToken } from '../tokens/index.js'
import { createMediaShell } from '../media-shell/index.js'
import { describeEntry, formatEntryBytes } from '../namespace/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { ARCHIVE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export interface ArchiveViewerOptions {
  readonly localizer?: UiLocalizer
  /**
   * Open a member as a document of its own — a new editor tab in VS Code. Absent, the viewer
   * dispatches `modkit-open-source` with the member's leased source, as the namespace view does.
   */
  readonly openEntry?: (entry: NamespaceEntry) => void | Promise<void>
  /**
   * Run a file-manager action — the host asks for names, confirms deletes and owns the clipboard.
   * Answers `true` when the archive changed. Absent, the viewer offers no context menu.
   */
  readonly act?: (action: ArchiveAction, target: ArchiveTarget) => Promise<boolean>
  /** Draw the archive again after a change, from its new revision. */
  readonly reload?: (descriptor: AnyDescriptor) => Promise<unknown>
}

/** What the Explorer offers on a file, a folder or the archive itself. */
export type ArchiveAction =
  'open' | 'new-file' | 'new-folder' | 'rename' | 'delete' | 'copy-path' | 'copy-relative-path'

/** A path inside the archive (`''` for the archive itself) and what is there. */
export interface ArchiveTarget {
  readonly path: string
  readonly kind: 'file' | 'folder' | 'root'
}

/** Listing pages read before the tree says it is incomplete. */
const PAGE_SIZE = 500
const MAXIMUM_PAGES = 200

interface Folder {
  readonly name: string
  readonly path: string
  readonly folders: Map<string, Folder>
  readonly files: NamespaceEntry[]
}

const folder = (name: string, path: string): Folder => ({
  name,
  path,
  folders: new Map(),
  files: [],
})

const normalizedPath = (path: string): string =>
  path
    .split('/')
    .filter(part => part !== '')
    .join('/')

/** Every member under its folder, with the folders a path implies created on the way. */
export function buildArchiveTree(entries: readonly NamespaceEntry[]): Folder {
  const root = folder('', '')
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(part => part !== '')
    // A stored directory entry is a folder, so every one of its parts is.
    const folders = entry.kind === 'directory' ? parts : parts.slice(0, -1)
    let cursor = root
    for (const part of folders) {
      let next = cursor.folders.get(part)
      if (next === undefined) {
        next = folder(part, cursor.path === '' ? part : `${cursor.path}/${part}`)
        cursor.folders.set(part, next)
      }
      cursor = next
    }
    if (entry.kind === 'file') cursor.files.push(entry)
  }
  return root
}

const byName = (left: { name: string }, right: { name: string }): number =>
  left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })

const countFolders = (node: Folder): number =>
  [...node.folders.values()].reduce((sum, child) => sum + 1 + countFolders(child), 0)

/** `AnyDescriptor` also covers the unresolved arm, which carries no metadata. */
function metadataGroups(descriptor: AnyDescriptor): readonly MetadataGroup[] {
  return 'identity' in descriptor
    ? ((descriptor as { readonly metadata?: readonly MetadataGroup[] }).metadata ?? [])
    : []
}

function facts(parent: HTMLElement, rows: readonly (readonly [string, string])[]): void {
  parent.replaceChildren()
  const list = element(parent, 'dl', { part: 'image.metadata' })
  for (const [label, value] of rows) {
    const row = element(list, 'div', { part: 'metadata.row' })
    element(row, 'dt', { text: label, part: 'metadata.label' })
    setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 512)
  }
}

export function createArchiveViewer(options: ArchiveViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, ARCHIVE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.archive'))
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...(args.gallery === undefined ? {} : { gallery: args.gallery }),
      })
      root.append(shell.root)
      scope.cleanup(() => shell.destroy())
      if (args.gallery !== undefined) void shell.refreshGallery(scope.signal).catch(() => undefined)
      const stage = element(shell.stage, 'div', { part: 'archive.members' })
      const tree = element(stage, 'ul', { part: 'archive.member-list', role: 'tree' })
      tree.setAttribute('aria-label', localizer.text('viewer.archive'))

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/namespace-entry-source',
      )
      if (lease === undefined) throw new TypeError('archive binding is unavailable')
      scope.lease(lease)
      const source = lease.value as NamespaceEntrySource

      setState(stage, ['loading'])
      const entries: NamespaceEntry[] = []
      let capped = false
      let cursor: string | undefined
      for (let page = 0; ; page += 1) {
        if (page === MAXIMUM_PAGES) {
          capped = true
          break
        }
        const listed = await source.list(
          '',
          { limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
          scope.signal,
        )
        entries.push(...listed.items)
        cursor = listed.nextCursor
        if (cursor === undefined) break
      }
      setState(stage, [])

      const files = entries.filter(entry => entry.kind === 'file')
      const total = files.reduce((sum, entry) => sum + (entry.size ?? 0n), 0n)
      const stored = files.every(entry => entry.storedSize !== undefined)
        ? files.reduce((sum, entry) => sum + (entry.storedSize ?? 0n), 0n)
        : undefined
      const top = buildArchiveTree(entries)

      const archiveRows: (readonly [string, string])[] = [
        [localizer.text('viewer.archiveFiles'), String(files.length)],
        [localizer.text('viewer.archiveFolders'), String(countFolders(top))],
        [localizer.text('viewer.archiveSize'), formatEntryBytes(total)],
      ]
      if (stored !== undefined) {
        archiveRows.push([localizer.text('viewer.archiveStored'), formatEntryBytes(stored)])
      }
      if (capped) archiveRows.push([localizer.text('viewer.archiveCapped'), String(entries.length)])
      facts(
        shell.section('archive', localizer.text('viewer.archive'), { icon: 'archive' }).body,
        archiveRows,
      )
      const selected = shell.section('entry', localizer.text('viewer.archiveEntry'), {
        icon: 'file',
      })
      element(selected.body, 'p', {
        part: 'viewer.empty',
        text: localizer.text('viewer.archivePick'),
      })
      for (const group of metadataGroups(args.descriptor)) {
        if (/^(identity|traits|detection)$/iu.test(group.id)) continue
        facts(
          shell.section(`metadata:${group.id}`, group.label, {
            icon: 'symbol-misc',
            collapsed: true,
          }).body,
          group.entries.map(entry => [entry.key, String(entry.value)] as const),
        )
      }
      args.status?.set([
        {
          id: 'files',
          icon: 'files',
          text: localizer.text('viewer.archiveFileCount', { count: files.length }),
          align: 'start',
        },
        { id: 'size', icon: 'database', text: formatEntryBytes(total), align: 'start' },
      ])
      scope.cleanup(() => args.status?.clear())

      const document = root.ownerDocument
      let current: HTMLElement | undefined
      const select = (row: HTMLElement, entry?: NamespaceEntry): void => {
        current?.removeAttribute('aria-selected')
        row.setAttribute('aria-selected', 'true')
        current = row
        if (entry === undefined) return
        const detail = describeEntry(entry, localizer)
        const rows: (readonly [string, string])[] = [
          [localizer.text('viewer.archivePath'), entry.path],
        ]
        if (entry.size !== undefined) {
          rows.push([localizer.text('viewer.archiveSize'), formatEntryBytes(entry.size)])
        }
        if (detail !== '') rows.push([localizer.text('viewer.archiveStorage'), detail])
        facts(selected.body, rows)
      }
      const open = async (entry: NamespaceEntry): Promise<void> => {
        if (options.openEntry !== undefined) {
          await options.openEntry(entry)
          return
        }
        const opened = await source.openEntry(entry.id, scope.signal)
        try {
          root.dispatchEvent(
            new CustomEvent('modkit-open-source', {
              bubbles: true,
              detail: { source: opened.value, entryId: entry.id, revision: entry.revision },
            }),
          )
        } finally {
          await opened.release()
        }
      }

      /** One tree row: a chevron (blank for a file), the kind's icon and the name. */
      const row = (
        parent: HTMLElement,
        name: string,
        kind: 'folder' | 'file',
      ): { readonly item: HTMLElement; readonly button: HTMLButtonElement } => {
        const item = element(parent, 'li', { part: 'archive.item', role: 'treeitem' })
        const button = element(item, 'button', { part: 'archive.row' }) as HTMLButtonElement
        button.type = 'button'
        button.append(
          icon(document, kind === 'folder' ? 'chevron-right' : 'blank'),
          icon(document, kind === 'folder' ? 'folder' : 'file'),
        )
        element(button, 'span', { part: 'archive.name', text: name })
        return { item, button }
      }

      const say = (error: unknown): void => {
        element(selected.body, 'p', {
          part: 'viewer.empty',
          text: error instanceof Error ? error.message : String(error),
        })
      }

      /** One file-manager action; a change to the archive redraws it from its new revision. */
      const act = (action: ArchiveAction, target: ArchiveTarget): void => {
        if (options.act === undefined) return
        void options
          .act(action, target)
          .then(async changed => {
            if (changed) await options.reload?.(args.descriptor)
          })
          .catch(say)
      }

      // ------------------------------------------------------------ context menu
      let menu: HTMLElement | undefined
      const closeMenu = (): void => {
        menu?.remove()
        menu = undefined
      }
      const onOutside = (event: Event): void => {
        if (menu !== undefined && !menu.contains(event.target as Node)) closeMenu()
      }
      const onEscape = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') closeMenu()
      }
      document.addEventListener('mousedown', onOutside, true)
      document.addEventListener('keydown', onEscape, true)
      scope.cleanup(() => {
        document.removeEventListener('mousedown', onOutside, true)
        document.removeEventListener('keydown', onEscape, true)
        closeMenu()
      })

      /** VS Code's Explorer menu, per kind: what a file, a folder or the archive itself offers. */
      const MENU: Readonly<Record<ArchiveTarget['kind'], readonly (ArchiveAction | '-')[]>> = {
        file: ['open', '-', 'rename', 'delete', '-', 'copy-path', 'copy-relative-path'],
        folder: [
          'new-file',
          'new-folder',
          '-',
          'rename',
          'delete',
          '-',
          'copy-path',
          'copy-relative-path',
        ],
        root: ['new-file', 'new-folder', '-', 'copy-path'],
      }
      const LABEL: Readonly<Record<ArchiveAction, Parameters<typeof localizer.text>[0]>> = {
        open: 'viewer.archiveOpen',
        'new-file': 'viewer.archiveNewFile',
        'new-folder': 'viewer.archiveNewFolder',
        rename: 'viewer.archiveRename',
        delete: 'viewer.archiveDelete',
        'copy-path': 'viewer.archiveCopyPath',
        'copy-relative-path': 'viewer.archiveCopyRelativePath',
      }
      const openMenu = (target: ArchiveTarget, x: number, y: number): void => {
        closeMenu()
        if (options.act === undefined) return
        const node = element(root, 'div', { part: 'explorer.tabmenu', role: 'menu' })
        setToken(node, 'explorer.menu-x', `${Math.round(x)}px`)
        setToken(node, 'explorer.menu-y', `${Math.round(y)}px`)
        for (const action of MENU[target.kind]) {
          if (action === '-') {
            element(node, 'hr', { part: 'toolbar.separator' })
            continue
          }
          const item = element(node, 'button', {
            part: 'explorer.tabmenu-item',
            role: 'menuitem',
            text: localizer.text(LABEL[action]),
          }) as HTMLButtonElement
          item.type = 'button'
          item.addEventListener('click', () => {
            closeMenu()
            act(action, target)
          })
        }
        menu = node
        ;(node.firstElementChild as HTMLElement | null)?.focus()
      }

      /** Right-click, F2, Delete and Enter on a row, as in the Explorer. */
      const wire = (
        button: HTMLButtonElement,
        target: ArchiveTarget,
        activate: () => void,
      ): void => {
        button.addEventListener('click', activate)
        button.addEventListener('contextmenu', event => {
          event.preventDefault()
          event.stopPropagation()
          select(button)
          openMenu(target, event.clientX, event.clientY)
        })
        button.addEventListener('keydown', event => {
          if (event.key === 'F2') act('rename', target)
          else if (event.key === 'Delete') act('delete', target)
          else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            const box = button.getBoundingClientRect()
            openMenu(target, box.left + 16, box.bottom)
          } else return
          event.preventDefault()
        })
      }
      stage.addEventListener('contextmenu', event => {
        event.preventDefault()
        openMenu({ path: '', kind: 'root' }, event.clientX, event.clientY)
      })

      const render = (parent: HTMLElement, node: Folder): void => {
        for (const child of [...node.folders.values()].sort(byName)) {
          const { item, button } = row(parent, child.name, 'folder')
          item.setAttribute('aria-expanded', 'false')
          let children: HTMLElement | undefined
          wire(button, { path: child.path, kind: 'folder' }, () => {
            select(button)
            if (children === undefined) {
              children = element(item, 'ul', { part: 'archive.children', role: 'group' })
              render(children, child)
            } else {
              children.hidden = !children.hidden
            }
            const expanded = !children.hidden
            item.setAttribute('aria-expanded', String(expanded))
            button.children[0]?.replaceWith(
              icon(document, expanded ? 'chevron-down' : 'chevron-right'),
            )
            button.children[1]?.replaceWith(icon(document, expanded ? 'folder-opened' : 'folder'))
          })
        }
        for (const entry of [...node.files].sort(byName)) {
          const { button } = row(parent, entry.name, 'file')
          if (entry.size !== undefined) {
            element(button, 'span', { part: 'archive.detail', text: formatEntryBytes(entry.size) })
          }
          button.title = entry.path
          wire(button, { path: normalizedPath(entry.path), kind: 'file' }, () => {
            select(button, entry)
            void open(entry).catch(say)
          })
        }
      }
      render(tree, top)
      if (entries.length === 0) {
        element(stage, 'p', { part: 'viewer.empty', text: localizer.text('viewer.archiveEmpty') })
      }

      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const archiveViewer: ViewerModule = createArchiveViewer()
