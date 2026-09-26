/** The Resources tree view: the host's loaded mods. */
import * as vscode from 'vscode'
import { type UiLocalizer } from '@modkit/ui/localization'

import type { TreeDataSource, TreeNodeFacts, TreeNodeRef } from '@modkit/sdk'
import { type VsCodeServed } from './host.js'

/** How many children of one resource node the view will render before it says it stopped. */
export const RESOURCE_CHILD_LIMIT = 20_000
/** Facts fetched at once; the protocol allows 256 calls in flight across everything. */
export const RESOURCE_FACT_BATCH = 32

export type ResourceTreeNode =
  | Readonly<{
      kind: 'resource'
      ref: TreeNodeRef
      facts: TreeNodeFacts
    }>
  /*
   * A node *inside* a resource file, answered by that format's own codec.
   *
   * A `.galaxy`, `.SC2Layout` or `.SC2Style` file is not a leaf: its functions, frames and styles
   * are the resources an author actually references. Each of those formats already publishes a
   * tree, so the file expands into that tree rather than this view learning a second parser.
   */
  | Readonly<{
      kind: 'member'
      subject: string
      ref: TreeNodeRef
      facts: TreeNodeFacts
    }>
  | Readonly<{
      kind: 'more'
      parent: TreeNodeRef
      cursor: string
    }>
  | Readonly<{
      kind: 'notice'
      label: string
      detail?: string
    }>

export interface ResourceTreeHost extends Pick<VsCodeServed, 'openTreeDataSource'> {
  /** Why the focused document's mod did not load; the mods already loaded are still shown. */
  readonly failure?: string
  /** A resource opens at its declaration when the node carries one. */
  navigate(subjectId: string, range?: TreeNodeFacts['range']): void
}

/** Opens the tree a resource file publishes through its own codec, when it publishes one. */
export type ResourceMemberTrees = Readonly<{
  /** The subject string of the file a resource node names, when this window can open it. */
  subjectOf(subjectId: string): string | undefined
  open(subject: string): Promise<TreeDataSource | undefined>
  /** Shows the file a member node lives in, at that node's own position. */
  reveal(subject: string, range?: TreeNodeFacts['range']): void
  reset(): void
}>

/** Native projection of the host's persistent loaded-mod resource tree. */
export class ResourcesView implements vscode.TreeDataProvider<ResourceTreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ResourceTreeNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  private searchResults: readonly ResourceTreeNode[] | undefined
  private generation = 0

  constructor(
    private readonly localizer: UiLocalizer,
    private readonly loaded: () => Promise<ResourceTreeHost | undefined>,
    private readonly members?: ResourceMemberTrees,
  ) {}

  dispose(): void {
    this.changed.dispose()
  }

  refresh(): void {
    this.generation += 1
    this.searchResults = undefined
    this.members?.reset()
    this.changed.fire(undefined)
  }

  async open(node?: ResourceTreeNode): Promise<boolean> {
    // The command is also reachable from the palette, where there is no node at all.
    if (node === undefined || node.kind === 'notice' || node.kind === 'more') return false
    if (node.kind === 'member') {
      // A node inside a file — a Galaxy function, a layout frame — opens that file at its own
      // position. Its subject is the file, so there is nothing to resolve.
      this.members?.reveal(node.subject, node.facts.range)
      return true
    }
    if (node.facts.subjectId === undefined) return false
    const served = await this.loaded()
    if (served === undefined) return false
    served.navigate(node.facts.subjectId, node.facts.range)
    return true
  }

  /** The file subject a resource node names, when that file has a codec that publishes a tree. */
  private memberSubjectOf(node: ResourceTreeNode): string | undefined {
    if (node.kind !== 'resource' || node.facts.subjectId === undefined) return undefined
    return this.members?.subjectOf(node.facts.subjectId)
  }

  private async loadMember(subject: string, parent?: TreeNodeRef): Promise<ResourceTreeNode[]> {
    const tree = await this.members?.open(subject)
    if (tree === undefined) return []
    const node = parent ?? (await tree.root())
    const items: TreeNodeRef[] = []
    let cursor: string | undefined
    do {
      const page = await tree.children(
        node,
        cursor === undefined ? { limit: 500 } : { cursor, limit: 500 },
      )
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor !== undefined && items.length < RESOURCE_CHILD_LIMIT)
    const nodes: ResourceTreeNode[] = []
    for (let start = 0; start < items.length; start += RESOURCE_FACT_BATCH) {
      const batch = items.slice(start, start + RESOURCE_FACT_BATCH)
      nodes.push(
        ...(await Promise.all(
          batch.map(async ref =>
            Object.freeze({ kind: 'member' as const, subject, ref, facts: await tree.facts(ref) }),
          ),
        )),
      )
    }
    return nodes
  }

  private notice(label: string, detail?: string): ResourceTreeNode {
    return Object.freeze({ kind: 'notice', label, ...(detail === undefined ? {} : { detail }) })
  }

  /*
   * Children arrive as one list, not as a chain of «Load more» nodes.
   *
   * A cursor node made the rest of a catalog a *child* of the last page, so a long list grew
   * sideways into nested trees instead of continuing. The pages are drained here and the list is
   * flat; the cap is what keeps a runaway source from filling the view forever.
   */
  private async loadPage(
    tree: TreeDataSource,
    parent: TreeNodeRef,
    cursor?: string,
  ): Promise<ResourceTreeNode[]> {
    const items: TreeNodeRef[] = []
    let next = cursor
    do {
      const page = await tree.children(
        parent,
        next === undefined ? { limit: 500 } : { cursor: next, limit: 500 },
      )
      items.push(...page.items)
      next = page.nextCursor
    } while (next !== undefined && items.length < RESOURCE_CHILD_LIMIT)
    /*
     * Facts are fetched in bounded batches. One `Promise.all` over a whole catalog put thousands
     * of calls on the wire at once and tripped the protocol's 256 pending-call ceiling, which the
     * reader saw as «pending call limit 256 reached» on Abil and on layouts.
     */
    const nodes: ResourceTreeNode[] = []
    for (let start = 0; start < items.length; start += RESOURCE_FACT_BATCH) {
      const batch = items.slice(start, start + RESOURCE_FACT_BATCH)
      nodes.push(
        ...(await Promise.all(
          batch.map(async ref =>
            Object.freeze({ kind: 'resource' as const, ref, facts: await tree.facts(ref) }),
          ),
        )),
      )
    }
    return next === undefined
      ? nodes
      : [
          ...nodes,
          this.notice(
            this.localizer.text('vscode.resources.truncated', {
              count: String(RESOURCE_CHILD_LIMIT),
            }),
          ),
        ]
  }

  private async load(parent: TreeNodeRef, cursor?: string): Promise<ResourceTreeNode[]> {
    const served = await this.loaded()
    if (served === undefined) {
      return [this.notice(this.localizer.text('vscode.resources.noActiveSubject'))]
    }
    const lease = await served.openTreeDataSource()
    if (lease === undefined) {
      return [this.notice(this.localizer.text('vscode.resources.unavailable'))]
    }
    try {
      return await this.loadPage(lease.value, parent, cursor)
    } finally {
      await lease.release()
    }
  }

  async search(pattern: string | undefined): Promise<void> {
    const query = pattern?.trim()
    if (!query) {
      this.refresh()
      return
    }
    const served = await this.loaded()
    const lease = await served?.openTreeDataSource()
    if (lease === undefined) {
      this.searchResults = [this.notice(this.localizer.text('vscode.resources.unavailable'))]
      this.changed.fire(undefined)
      return
    }
    const generation = ++this.generation
    try {
      const found: ResourceTreeNode[] = []
      for await (const ref of lease.value.search({ pattern: query })) {
        found.push(Object.freeze({ kind: 'resource', ref, facts: await lease.value.facts(ref) }))
        if (found.length >= 200) break
      }
      if (generation !== this.generation) return
      this.searchResults =
        found.length === 0
          ? [this.notice(this.localizer.text('vscode.resources.noMatches', { query }))]
          : Object.freeze(found)
      this.changed.fire(undefined)
    } finally {
      await lease.release()
    }
  }

  getTreeItem(node: ResourceTreeNode): vscode.TreeItem {
    if (node.kind === 'notice') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.iconPath = new vscode.ThemeIcon('info')
      if (node.detail !== undefined) item.description = node.detail
      item.tooltip = node.detail ?? node.label
      return item
    }
    if (node.kind === 'more') {
      const item = new vscode.TreeItem(
        this.localizer.text('vscode.resources.loadMore'),
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.iconPath = new vscode.ThemeIcon('ellipsis')
      return item
    }
    const item = new vscode.TreeItem(
      node.facts.label,
      // A file whose format publishes a tree is expandable even when the package lists it as a
      // leaf: its children come from the file's codec.
      node.ref.hasChildren || (node.kind === 'resource' && this.memberSubjectOf(node) !== undefined)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    )
    item.id = node.kind === 'member' ? `${node.subject}|${node.ref.id}` : node.ref.id
    if (node.facts.preview !== undefined) item.description = node.facts.preview
    item.tooltip = node.facts.preview ?? node.facts.label
    item.contextValue =
      node.facts.subjectId === undefined ? 'modkitResource.node' : 'modkitResource.openable'
    item.iconPath = new vscode.ThemeIcon(
      node.facts.kind === 'mod'
        ? 'package'
        : node.ref.hasChildren
          ? 'symbol-folder'
          : /file|document|script|layout|string|style/iu.test(node.facts.kind)
            ? 'file'
            : 'symbol-field',
    )
    if (node.facts.subjectId !== undefined) {
      item.command = {
        command: 'modkit.resources.open',
        title: this.localizer.text('vscode.resources.open'),
        arguments: [node],
      }
    }
    return item
  }

  async getChildren(node?: ResourceTreeNode): Promise<ResourceTreeNode[]> {
    try {
      if (node?.kind === 'notice') return []
      if (node?.kind === 'more') return this.load(node.parent, node.cursor)
      if (node?.kind === 'member') return this.loadMember(node.subject, node.ref)
      if (node?.kind === 'resource') {
        // A file that publishes its own tree expands into it; anything else expands as before.
        const subject = node.ref.hasChildren ? undefined : this.memberSubjectOf(node)
        return subject === undefined ? this.load(node.ref) : this.loadMember(subject)
      }
      if (this.searchResults !== undefined) return [...this.searchResults]
      const served = await this.loaded()
      if (served === undefined) {
        return [this.notice(this.localizer.text('vscode.resources.noActiveSubject'))]
      }
      const lease = await served.openTreeDataSource()
      if (lease === undefined) {
        return [this.notice(this.localizer.text('vscode.resources.unavailable'))]
      }
      try {
        const root = await lease.value.root()
        const items = await this.loadPage(lease.value, root)
        const failed =
          served.failure === undefined
            ? []
            : [this.notice(this.localizer.text('vscode.resources.failed'), served.failure)]
        return items.length === 0 && failed.length === 0
          ? [this.notice(this.localizer.text('vscode.resources.noActiveSubject'))]
          : [...failed, ...items]
      } finally {
        await lease.release()
      }
    } catch (error) {
      return [
        this.notice(
          this.localizer.text('vscode.resources.failed'),
          error instanceof Error ? error.message : String(error),
        ),
      ]
    }
  }
}

// ---------------------------------------------------------------------------------------------
// activation
