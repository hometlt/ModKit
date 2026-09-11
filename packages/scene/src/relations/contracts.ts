import type { RelationGraphNode, RelationGraphEdge, RelationGraphTypeBucket } from '@modkit/sdk'

/** Scene owns renderer contracts; the UI retains graph controls and navigation. */
export interface GraphRenderState {
  readonly nodes: readonly RelationGraphNode[]
  readonly edges: readonly RelationGraphEdge[]
  readonly types: readonly RelationGraphTypeBucket[]
  readonly labels: boolean
  readonly palette: Readonly<Record<string, string>>
}
export interface GraphRenderer {
  render(state: GraphRenderState): void
  resize(width: number, height: number): void
  reset(): void
  destroy(): void
  drawnEdges?(): number
}
export interface GraphRendererFactory {
  readonly id: string
  readonly label: string
  create(host: HTMLElement, hooks: { onOpen?(node: RelationGraphNode): void }): GraphRenderer
}
