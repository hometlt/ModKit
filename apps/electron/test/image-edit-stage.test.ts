/**
 * The Electron PNG editor's renderer-owned half.
 *
 * Encoding belongs to the host, so this file proves the exact RGBA8 semantic change handed to
 * that host writer and the stage policy that prevents the editor from appearing without it. The
 * real encoder, disk commit, reopen, dimensions, and changed pixel are covered by `--selftest`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { revisionId } from '@modkitx-x3/sdk'
import type { AssetRevision, SubjectEditTarget } from '@modkitx-x3/sdk'

import { PNG_SEMANTIC_WARNING, pngPixelChange } from '../src/image-edit-stage.js'

const stagesSource = readFileSync(new URL('../src/stages.ts', import.meta.url), 'utf8')

const REVISION: AssetRevision = Object.freeze({
  bindings: Object.freeze({ content: revisionId('provider-token:1-2-3-4') }),
  compositionFingerprint: 'png-editor-test',
})

const TARGET: SubjectEditTarget = Object.freeze({
  targetId: 'content',
  subjectUri: 'file:///sample.png',
  ownerSource: Object.freeze({ id: 'png-source', uri: 'file:///sample.png' }),
  semanticPath: Object.freeze([]),
  expectedRevision: REVISION,
})

describe('the Electron PNG pixel stage', () => {
  it('authors a copied RGBA8 replacement with explicit dimensions', () => {
    const source = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])
    const pixels = { width: 2, height: 1, data: source } as ImageData
    const change = pngPixelChange(pixels, [TARGET])

    expect(change.targets).toEqual([TARGET])
    expect(change.semanticIntent).toEqual({ width: 2, height: 1 })
    expect(change.provenance).toEqual({ actor: 'user', note: 'Electron PNG pixel editor' })
    expect(change.edits).toHaveLength(1)
    expect(change.edits[0]).toMatchObject({
      operation: 'replace',
      targetId: 'content',
      source: TARGET.ownerSource,
      payload: { kind: 'inline' },
    })

    const edit = change.edits[0]
    if (edit?.operation !== 'replace' || edit.payload.kind !== 'inline') {
      throw new TypeError('expected the PNG pixel replacement payload')
    }
    expect([...edit.payload.bytes]).toEqual([...source])
    source[0] = 99
    expect(edit.payload.bytes[0]).toBe(1)
  })

  it('rejects a missing target or an impossible RGBA8 shape', () => {
    const onePixel = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData
    expect(() => pngPixelChange(onePixel, [])).toThrow('no editable source target')
    expect(() =>
      pngPixelChange({ width: 2, height: 1, data: new Uint8ClampedArray(4) } as ImageData, [
        TARGET,
      ]),
    ).toThrow('do not match')
  })

  it('states the semantic PNG metadata loss before save', () => {
    expect(PNG_SEMANTIC_WARNING).toContain('re-encodes the PNG')
    expect(PNG_SEMANTIC_WARNING).toContain('Metadata and unknown PNG chunks are removed')
  })

  it('offers the editor only when main resolved the PNG writer', () => {
    expect(stagesSource).toMatch(
      /options\.imageEditing === true[\s\S]*?appStage\([\s\S]*?'image-edit',[\s\S]*?true/,
    )
    const readOnlyFactory = stagesSource.slice(
      stagesSource.indexOf('export function createElectronReadOnlyStages'),
    )
    expect(readOnlyFactory).not.toContain("appStage('image-edit'")
  })
})
