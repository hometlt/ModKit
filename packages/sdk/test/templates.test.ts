import { describe, expect, it } from 'vitest'
import {
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  isGameTemplatePreviewResult,
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
