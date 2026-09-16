/**
 * The template stage draws what the producer resolved.
 *
 * Nothing here is StarCraft II: a box is a rectangle, text is its runs in the colours the producer
 * decided, and an image is the rectangle plus the asset it names. The document is a stub because
 * this package's unit tests run in Node; the browser end of it is covered by the e2e suite.
 */
import { describe, expect, it } from 'vitest'
import type { GameTemplateDisplayItem } from '@modkit/sdk/templates'
import { drawTemplateItems } from '../src/template/index.js'

interface StubNode {
  readonly name: string
  readonly attributes: Record<string, string>
  readonly children: StubNode[]
  textContent: string
}

function stubDocument(): { document: Document; host: StubNode } {
  const create = (name: string): StubNode => ({
    name,
    attributes: {},
    children: [],
    textContent: '',
    setAttribute(key: string, value: string) {
      ;(this as unknown as StubNode).attributes[key] = value
    },
    append(...nodes: StubNode[]) {
      ;(this as unknown as StubNode).children.push(...nodes)
    },
  } as unknown as StubNode)
  const document = {
    createElementNS: (_namespace: string, name: string) => create(name),
    createElement: (name: string) => create(name),
  } as unknown as Document
  return { document, host: create('div') }
}

const find = (node: StubNode, name: string): StubNode[] =>
  node.children.flatMap(child => [...(child.name === name ? [child] : []), ...find(child, name)])

const ITEMS: readonly GameTemplateDisplayItem[] = [
  { kind: 'box', path: ['Dialog'], rect: { x: 0, y: 0, width: 400, height: 300 }, frameType: 'Frame' },
  {
    kind: 'text',
    path: ['Dialog', 'Title'],
    rect: { x: 10, y: 10, width: 200, height: 24 },
    text: [{ text: 'Nydus Canal', color: '#4aa3ff' }, { text: ' established' }],
  },
  {
    kind: 'image',
    path: ['Dialog', 'Icon'],
    rect: { x: 10, y: 40, width: 32, height: 32 },
    asset: 'Assets/Textures/btn-hatchery.dds',
    visible: false,
  },
  // A one-pixel spacer: drawn, but a label in it would be unreadable.
  { kind: 'text', path: ['Dialog', 'Spacer'], rect: { x: 0, y: 0, width: 400, height: 1 }, text: 'x' },
]

describe('template canvas', () => {
  it('places every item and keeps the producer’s styling', () => {
    const { document, host } = stubDocument()
    drawTemplateItems(document, host as unknown as HTMLElement, ITEMS)

    const canvas = host.children[0]
    expect(canvas?.name).toBe('svg')
    expect(canvas?.attributes['viewBox']).toBe('0 0 400 300')
    expect(canvas?.attributes['data-items']).toBe('4')
    expect(find(host, 'rect')).toHaveLength(4)

    const runs = find(host, 'tspan')
    expect(runs.map(run => run.textContent)).toEqual(['Nydus Canal', ' established'])
    expect(runs[0]?.attributes['fill']).toBe('#4aa3ff')
    expect(runs[1]?.attributes['fill']).toBeUndefined()

    // The asset is named, never fetched: a viewer may not turn a logical id into a request.
    const labels = find(host, 'text').map(node => node.textContent)
    expect(labels).toContain('btn-hatchery.dds')
    // Unreadably short rows carry no label.
    expect(labels).not.toContain('x')

    const hidden = canvas?.children.filter(node => node.attributes['data-hidden'] === 'true')
    expect(hidden).toHaveLength(1)
    expect(hidden?.[0]?.attributes['data-path']).toBe('Dialog/Icon')
    expect(find(host, 'title').map(node => node.textContent)).toContain('Dialog — Frame')
  })
})
