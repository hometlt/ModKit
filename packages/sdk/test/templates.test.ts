import { describe, expect, it } from 'vitest'
import {
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  gameTemplateTextRuns,
  isGameTemplateDisplayItem,
  isGameTemplatePreviewResult,
  isGameTemplateTextRun,
} from '../src/templates/index.js'

describe('game template preview contract', () => {
  const result = {
    schemaVersion: 1,
    operationId: GAME_TEMPLATE_PREVIEW_OPERATION_ID,
    templateKind: 'fixture-tech-tree',
    entryUri: 'fixture://tree',
    rootPath: 'root',
    resolvedTree: { id: 'root', children: [] },
    displayItems: [{ kind: 'node', id: 'root' }],
    diagnostics: [],
    completeness: 'complete',
    fidelity: { comparison: 'semantic', unsupported: [] },
    provenance: { source: 'fixture' },
    digest: { algorithm: 'sha256', value: '00' },
  } as const

  it('accepts the stable semantic envelope', () => {
    expect(isGameTemplatePreviewResult(result)).toBe(true)
  })

  it('accepts the roots a producer offers and nothing else in their place', () => {
    expect(isGameTemplatePreviewResult({ ...result, roots: ['root', 'other'] })).toBe(true)
    expect(isGameTemplatePreviewResult({ ...result, roots: 'root' })).toBe(false)
    expect(isGameTemplatePreviewResult({ ...result, roots: [1] })).toBe(false)
  })

  it('rejects candidate and pixel-comparison envelopes', () => {
    expect(isGameTemplatePreviewResult({ ...result, operationId: 'vendor/candidate' })).toBe(false)
    expect(
      isGameTemplatePreviewResult({
        ...result,
        fidelity: { comparison: 'pixel', unsupported: [] },
      }),
    ).toBe(false)
  })
})

describe('game template display items', () => {
  const box = { kind: 'box', path: ['Root'], rect: { x: 0, y: 0, width: 100, height: 40 } }

  it('accepts what any game can express and refuses what a viewer could not draw', () => {
    expect(isGameTemplateDisplayItem(box)).toBe(true)
    expect(isGameTemplateDisplayItem({ ...box, kind: 'image', asset: 'Assets/Icon.dds' })).toBe(true)
    expect(isGameTemplateDisplayItem({ ...box, kind: 'text', text: 'Hatchery' })).toBe(true)
    expect(
      isGameTemplateDisplayItem({
        ...box,
        kind: 'text',
        text: [{ text: 'Nydus Canal', color: '#4aa3ff' }, { text: ' established' }],
        visible: false,
        frameType: 'Label',
      }),
    ).toBe(true)
    // A rectangle is the one thing a viewer cannot do without.
    expect(isGameTemplateDisplayItem({ ...box, rect: { x: 0, y: 0, width: 100 } })).toBe(false)
    expect(isGameTemplateDisplayItem({ ...box, rect: { ...box.rect, x: Number.NaN } })).toBe(false)
    expect(isGameTemplateDisplayItem({ ...box, kind: 'sprite' })).toBe(false)
    expect(isGameTemplateDisplayItem({ ...box, path: ['Root', 2] })).toBe(false)
    expect(isGameTemplateDisplayItem({ ...box, text: [{ color: '#fff' }] })).toBe(false)
    // A glyph height is the producer's, in template units, and never zero or negative.
    expect(isGameTemplateDisplayItem({ ...box, text: [{ text: 'Title', size: 24 }] })).toBe(true)
    expect(isGameTemplateDisplayItem({ ...box, text: [{ text: 'Title', size: 0 }] })).toBe(false)
  })

  it('accepts an inline image run only when it draws no text, and an unresolved run', () => {
    expect(isGameTemplateTextRun({ text: '', asset: 'Assets/Icons/Mineral.dds' })).toBe(true)
    expect(isGameTemplateTextRun({ text: 'Mineral', asset: 'Assets/Icons/Mineral.dds' })).toBe(false)
    expect(isGameTemplateTextRun({ text: '', asset: 7 })).toBe(false)
    expect(isGameTemplateTextRun({ text: '?', unresolved: 'no catalog' })).toBe(true)
    expect(isGameTemplateTextRun({ text: '?', unresolved: true })).toBe(false)
  })

  it('reads a plain string as one unstyled run', () => {
    expect(gameTemplateTextRuns({ ...box, kind: 'text', text: 'Lair' } as never)).toEqual([
      { text: 'Lair' },
    ])
    expect(gameTemplateTextRuns(box as never)).toEqual([])
  })
})
