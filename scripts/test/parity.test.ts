import { describe, expect, it } from 'vitest'
import {
  classifyFormatParity,
  classifyParity,
  classifySourceParity,
  comparableMetadataFeatures,
  compareMeasurements,
  type SourceObservation,
} from '../parity/classify.mjs'
import { observeDataSource } from '../parity/observe.mjs'
import { blockingParityResults, buildParityReport, gitSha } from '../parity/report.mjs'

const source = (
  contract: string,
  measurements: Readonly<Record<string, string | number | boolean>>,
  features: readonly string[] = ['read'],
): SourceObservation => ({ contract, major: 1, state: 'opened', features, measurements })

describe('parity classification', () => {
  it('distinguishes parity, poorer, richer and missing X3 surfaces', () => {
    expect(classifyParity(['source:model'], ['source:model'])).toMatchObject({
      classification: 'паритет',
    })
    expect(classifyParity(['source:model', 'geometry:decoded'], ['source:model'])).toMatchObject({
      classification: 'X3 беднее',
      missing: ['geometry:decoded'],
    })
    expect(classifyParity(['source:model'], ['source:model', 'source:tree'])).toMatchObject({
      classification: 'X3 богаче',
      extra: ['source:tree'],
    })
    expect(classifyParity(['source:model'], [], false)).toMatchObject({
      classification: 'нет в X3',
    })
  })

  it('compares typed measurements directionally', () => {
    expect(
      compareMeasurements({ rows: 4, decoded: true }, { rows: 2, decoded: false }),
    ).toMatchObject({
      classification: 'X3 беднее',
      missing: ['measurement:decoded=true', 'measurement:rows:2<4'],
    })
    expect(compareMeasurements({ rows: 2 }, { rows: 4, schema: true })).toMatchObject({
      classification: 'X3 богаче',
      extra: ['measurement:rows:4>2', 'measurement:schema'],
    })
  })

  it('uses the worst source as the format result', () => {
    const canonical = {
      features: ['descriptor'],
      sources: [
        source('common.view/tree-data-source', { nodes: 4 }),
        source('common.view/text-data-source', { lines: 2 }),
      ],
    }
    const x3 = {
      features: ['descriptor', 'operation:export'],
      sources: [
        source('common.view/tree-data-source', { nodes: 3 }),
        source('common.view/text-data-source', { lines: 4 }),
      ],
    }
    const compared = classifyFormatParity(canonical, x3)
    expect(compared.classification).toBe('X3 беднее')
    expect(compared.sources.map(item => [item.contract, item.classification])).toEqual([
      ['common.view/text-data-source', 'X3 богаче'],
      ['common.view/tree-data-source', 'X3 беднее'],
    ])
  })

  it('keeps parity when richer format extras accompany an equal canonical source', () => {
    const canonicalSource = source('common.view/model-scene-source', { meshes: 1 })
    const compared = classifyFormatParity(
      { features: ['source:common.view/model-scene-source'], sources: [canonicalSource] },
      {
        features: ['source:common.view/model-scene-source', 'source:common.view/tree-data-source'],
        sources: [canonicalSource, source('common.view/tree-data-source', { nodes: 2 })],
      },
    )
    expect(compared.classification).toBe('паритет')
    expect(compared.extra).toEqual(['source:common.view/tree-data-source'])
  })

  it('treats an absent or failed declared source as poorer', () => {
    const canonical = source('common.view/tree-data-source', { nodes: 1 })
    expect(classifySourceParity(canonical).classification).toBe('X3 беднее')
    expect(
      classifySourceParity(canonical, {
        contract: canonical.contract,
        major: 1,
        state: 'failed',
        detail: 'boom',
      }).classification,
    ).toBe('X3 беднее')
  })

  it.each([
    ['common.view/namespace-entry-source', 'entries'],
    ['common.view/raster-image-source', 'decodedBytes'],
    ['common.view/tree-data-source', 'nodes'],
    ['common.view/table-data-source', 'rows'],
    ['common.view/text-data-source', 'lines'],
    ['common.view/model-scene-source', 'decodedVertices'],
  ])('detects poorer and equal %s measurements', (contract, measurement) => {
    const canonical = source(contract, { [measurement]: 2 })
    expect(
      classifySourceParity(canonical, source(contract, { [measurement]: 2 })).classification,
    ).toBe('паритет')
    expect(
      classifySourceParity(canonical, source(contract, { [measurement]: 1 })).classification,
    ).toBe('X3 беднее')
  })

  it('normalizes only comparable integer model metadata counters', () => {
    expect(comparableMetadataFeatures({ meshes: 1, nodes: 2, label: 'model' })).toEqual([
      'metadata:meshes',
      'metadata:nodes',
    ])
  })
})

describe('parity report v2', () => {
  it('records SHAs through a read-only git invocation', () => {
    const calls: unknown[] = []
    const sha = gitSha('C:/canonical', (...arguments_) => {
      calls.push(arguments_)
      return { status: 0, stdout: 'abc123\n', stderr: '' }
    })
    expect(sha).toBe('abc123')
    expect(calls).toEqual([
      ['git', ['-C', 'C:/canonical', 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }],
    ])
  })

  it('sorts formats and source contracts while retaining a visible environment skip', () => {
    const report = buildParityReport({
      corpus: 'corpus.json',
      canonical: { root: 'canonical', sha: 'aaa' },
      x3: { root: 'x3', sha: 'bbb' },
      results: [
        { format: 'zeta', state: 'skipped', sample: 'MODKITX_CNC3_ROOT', detail: 'not set' },
        {
          format: 'alpha',
          state: 'compared',
          classification: 'паритет',
          sourceComparisons: [
            { contract: 'z-source', classification: 'паритет', missing: [], extra: [] },
            { contract: 'a-source', classification: 'паритет', missing: [], extra: [] },
          ],
          canonical: { declaredSources: ['z-source', 'a-source'], sources: [] },
          x3: { declaredSources: ['a-source', 'z-source'], sources: [] },
        },
      ],
    })
    expect(report.summary).toEqual([
      { format: 'alpha', state: 'compared', classification: 'паритет' },
      { format: 'zeta', state: 'skipped', classification: null },
    ])
    expect(report.results[0]).toMatchObject({
      declared: { canonical: ['a-source', 'z-source'], x3: ['a-source', 'z-source'] },
      sourceComparisons: [{ contract: 'a-source' }, { contract: 'z-source' }],
    })
    expect(report.results[1]).toMatchObject({ sample: 'MODKITX_CNC3_ROOT', state: 'skipped' })
  })

  it('blocks failures, missing formats and unexplained poverty only', () => {
    expect(
      blockingParityResults([
        { format: 'failed', state: 'failed' },
        { format: 'missing', state: 'compared', classification: 'нет в X3' },
        { format: 'poor', state: 'compared', classification: 'X3 беднее' },
        {
          format: 'explained',
          state: 'compared',
          classification: 'X3 беднее',
          allowPoorerReason: 'tracked limitation',
        },
        { format: 'skip', state: 'skipped' },
      ]).map(result => result.format),
    ).toEqual(['failed', 'missing', 'poor'])
  })
})

describe('source-aware observations', () => {
  it('observes namespace enumeration and entry opening', async () => {
    const observed = await observeDataSource('common.view/namespace-entry-source', 1, {
      list: async () => ({
        items: [
          { id: 'folder', kind: 'directory' },
          { id: 'file', kind: 'file' },
        ],
      }),
      openEntry: async () => ({ value: { id: 'entry' }, release: async () => undefined }),
    })
    expect(observed).toMatchObject({
      state: 'opened',
      features: ['list', 'open-entry'],
      measurements: { entries: 2, files: 1, directories: 1, complete: true },
    })
  })

  it('observes decoded raster pixels', async () => {
    const observed = await observeDataSource('common.view/raster-image-source', 1, {
      info: async () => ({ width: 2, height: 3, channels: 4, decodedAccess: true }),
      encoded: async () => ({
        descriptor: async () => ({ mediaType: 'image/png', byteLength: 4n }),
        read: async () => new Uint8Array([1, 2, 3, 4]),
      }),
      readRegion: async () => ({ pixels: new Uint8Array([1, 2, 3, 4]) }),
    })
    expect(observed).toMatchObject({
      state: 'opened',
      features: ['decoded-region', 'encoded', 'info'],
      measurements: {
        width: 2,
        height: 3,
        channels: 4,
        decodedAccess: true,
        decodedBytes: 4,
        encodedNonEmpty: true,
        encodedMediaType: 'image/png',
      },
    })
  })

  it('walks a bounded tree and records depth and kinds', async () => {
    const observed = await observeDataSource('common.view/tree-data-source', 1, {
      root: async () => ({ id: 'root', hasChildren: true }),
      facts: async (node: { readonly id: string }) => ({ kind: node.id, label: node.id }),
      children: async () => ({ items: [{ id: 'leaf', hasChildren: false }] }),
    })
    expect(observed.measurements).toMatchObject({ nodes: 2, maxDepth: 1, kinds: 2, complete: true })
  })

  it('reads table shape, a row and a cell', async () => {
    const observed = await observeDataSource('common.view/table-data-source', 1, {
      shape: async () => ({ rows: 3, columns: 2, header: ['key', 'value'] }),
      rows: async () => ({ items: [{ index: 0, cells: ['a', 'b'] }] }),
      cell: async () => ({ value: 'a' }),
    })
    expect(observed).toMatchObject({
      features: ['cell', 'rows', 'shape'],
      measurements: { rows: 3, columns: 2, typedColumns: 2, firstPageRows: 1 },
    })
  })

  it('reads text info and a non-empty slice', async () => {
    const observed = await observeDataSource('common.view/text-data-source', 1, {
      info: async () => ({ encoding: 'utf-8', lines: 2 }),
      slice: async () => ({ text: 'hello\n', lineCount: 1 }),
    })
    expect(observed).toMatchObject({
      features: ['info', 'slice'],
      measurements: { encoding: 'utf-8', lines: 2, linesKnown: true, sliceNonEmpty: true },
    })
  })

  it('reads model geometry rather than accepting metadata alone', async () => {
    const observed = await observeDataSource('common.view/model-scene-source', 1, {
      info: async () => ({
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 0,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      }),
      nodes: async () => ({ items: [{ id: 'node' }] }),
      meshes: async () => ({ items: [{ id: 'mesh', primitiveIds: ['primitive'] }] }),
      primitive: async () => ({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }),
    })
    expect(observed).toMatchObject({
      features: ['info', 'meshes', 'nodes', 'primitive'],
      measurements: { decodedGeometry: true, decodedVertices: 3, decodedIndices: 3 },
    })
  })
})
