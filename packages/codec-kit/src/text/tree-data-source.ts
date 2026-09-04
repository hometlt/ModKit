import type { TreeDataSource, TreeNodeRef } from '@modkit/sdk'
import type { JsonNode } from '@modkit/sdk/text-data'
export function treeDataSource(document: object): TreeDataSource {
  const nodes = new Map<string, { value: unknown; label?: string; children: TreeNodeRef[] }>()
  const root = { id: 'root', hasChildren: true }
  nodes.set('root', { value: document, children: [] })
  const entries =
    (document as { root?: JsonNode }).root?.kind === 'object'
      ? (document as { root: Extract<JsonNode, { kind: 'object' }> }).root.members.map(member => [
          member.key,
          member.value,
        ])
      : Object.entries(document)
  ;(nodes.get('root') as { value: unknown; label?: string; children: TreeNodeRef[] }).children =
    entries.map(([key, value], index) => {
      const id = `root/${index}`
      nodes.set(id, { value, label: String(key), children: [] })
      return { id, hasChildren: false }
    })
  return {
    async root() {
      return root
    },
    async children(node, page) {
      const all = nodes.get(node.id)?.children ?? []
      const start = page.cursor ? Number(page.cursor) : 0
      const items = all.slice(start, start + page.limit)
      return {
        items,
        ...(start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}),
      }
    },
    async facts(node) {
      const item = nodes.get(node.id)
      return {
        kind: (item?.value as { kind?: string } | null)?.kind ?? 'value',
        label: item?.label ?? 'root',
        preview: (typeof item?.value === 'string' ? item.value : undefined) as string,
      }
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        if ((item.label ?? '').includes(query.pattern)) {
          yield { id, hasChildren: (item.children?.length ?? 0) > 0 }
        }
      }
    },
  }
}
