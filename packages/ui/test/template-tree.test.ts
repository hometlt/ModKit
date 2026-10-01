/**
 * The template stage's tree and element view: what a producer's resolved tree becomes as rows.
 *
 * The DOM half runs in the browser e2e suite; these are the rules it renders.
 */
import { describe, expect, it } from 'vitest'
import { isGameTemplateTreeNode, type GameTemplateTreeNode } from '@modkit/sdk/templates'
import {
  templateChain,
  templateNodeAt,
  templatePropertyRows,
  templateTreeRows,
} from '../src/template/index.js'

const TREE: GameTemplateTreeNode = {
  name: 'Panel',
  type: 'Frame',
  path: ['Panel'],
  children: [
    {
      name: 'Yard',
      type: 'Image',
      path: ['Panel', 'Yard'],
      template: 'Standard/TechItem',
      properties: [
        {
          name: 'Width',
          val: '#ItemSize',
          resolved: '64',
          source: { origin: 'template', frame: 'TechItem', uri: 'file:///mod/Standard.SC2Layout' },
        },
        {
          name: 'Alpha',
          val: '255',
          source: { origin: 'declaration', frame: 'Panel/Yard', uri: 'file:///mod/Tech.SC2Layout' },
        },
      ],
      anchors: [
        {
          side: 'Left',
          pos: 'Min',
          offset: '20',
          source: { origin: 'declaration', frame: 'Panel/Yard', uri: 'file:///mod/Tech.SC2Layout' },
        },
      ],
      children: [{ name: 'Icon', path: ['Panel', 'Yard', 'Icon'], children: [] }],
    },
    { name: 'Crane', type: 'Image', path: ['Panel', 'Crane'], children: [] },
  ],
}

describe('template tree panel', () => {
  it('lists nodes in document order with their depth and path key', () => {
    expect(isGameTemplateTreeNode(TREE)).toBe(true)
    expect(templateTreeRows(TREE).map(row => [row.key, row.depth])).toEqual([
      ['Panel', 0],
      ['Panel/Yard', 1],
      ['Panel/Yard/Icon', 2],
      ['Panel/Crane', 1],
    ])
    expect(templateTreeRows(TREE, 2)).toHaveLength(2)
  })

  it('refuses a tree a viewer could not list', () => {
    expect(isGameTemplateTreeNode({ name: 'x', path: ['x'] })).toBe(false)
    expect(isGameTemplateTreeNode({ name: 'x', path: [1], children: [] })).toBe(false)
    expect(
      isGameTemplateTreeNode({
        name: 'x',
        path: ['x'],
        children: [{ name: 'y', path: ['x', 'y'], children: [], properties: [{ val: '1' }] }],
      }),
    ).toBe(false)
    expect(isGameTemplateTreeNode(TREE, 3)).toBe(false)
  })
})

describe('template element view', () => {
  const yard = TREE.children[0] as GameTemplateTreeNode

  it('shows each value as written and as resolved, with where it came from', () => {
    expect(templatePropertyRows(yard)).toEqual([
      {
        name: 'Width',
        value: '#ItemSize → 64',
        origin: 'template · TechItem · Standard.SC2Layout',
      },
      { name: 'Alpha', value: '255', origin: 'declaration · Tech.SC2Layout' },
      { name: 'Anchor Left', value: '$parent Min 20', origin: 'declaration · Tech.SC2Layout' },
    ])
    expect(templatePropertyRows(TREE)).toEqual([])
  })

  it('names the template chain a node inherits', () => {
    expect(templateChain(yard)).toEqual(['Standard/TechItem', 'TechItem'])
    expect(templateChain(TREE)).toEqual([])
  })
})

describe('reveal in the template tree (3.33)', () => {
  const uri = 'file:///c%3A/mod/Base.SC2Data/UI/Layout/Tech.SC2Layout'
  const tree: GameTemplateTreeNode = {
    name: 'Panel',
    path: ['Panel'],
    source: { uri, start: 10, end: 400 },
    children: [
      { name: 'Yard', path: ['Panel', 'Yard'], source: { uri, start: 50, end: 120 }, children: [] },
      {
        name: 'Inherited',
        path: ['Panel', 'Inherited'],
        // declared in the template's file, not this one
        source: { uri: 'file:///c%3A/mod/Standard.SC2Layout', start: 60, end: 90 },
        children: [],
      },
    ],
  }

  it('finds the innermost node declared around an offset of the same document', () => {
    expect(templateNodeAt(tree, uri, 70)?.name).toBe('Yard')
    expect(templateNodeAt(tree, uri, 200)?.name).toBe('Panel')
    expect(templateNodeAt(tree, uri, 5)).toBeUndefined()
    // the same file however its URI is spelled
    expect(
      templateNodeAt(tree, 'file:///C:/mod/Base.SC2Data/UI/Layout/Tech.SC2Layout', 70)?.name,
    ).toBe('Yard')
    expect(templateNodeAt(tree, 'file:///c%3A/mod/Standard.SC2Layout', 70)?.name).toBe('Inherited')
  })
})
