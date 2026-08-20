/**
 * The Electron view policy, evaluated the way the renderer evaluates it.
 *
 * The renderer itself cannot run under vitest (it is a browser bundle over the preload bridge), so
 * everything decidable without a DOM lives in `src/view-policy.ts` and `src/namespace-index.ts`
 * and is proved here: what a subject offers, in what order, which panels apply, which operation
 * can extract an archive member, and the bounds of the namespace walk.
 */
import { describe, expect, it } from 'vitest'
import type { NamespaceEntry, Page } from '@modkitx-x3/sdk'

import {
  applicablePanels,
  applicableStages,
  descriptorOperations,
  entryPreviewOperations,
  orderStages,
  preferredStage,
  publishedContracts,
  selfTestLine,
  STAGE_ORDER,
  type StageFacts,
} from '../src/view-policy.js'
import { indexNamespace, NAMESPACE_MAXIMUM_DEPTH } from '../src/namespace-index.js'

const stage = (id: string, contract: string, trait?: string): StageFacts => ({
  id,
  label: id,
  contract,
  ...(trait === undefined ? {} : { trait }),
})

const descriptorWith = (
  contracts: readonly string[],
  traits: readonly string[] = [],
  operations: readonly Record<string, unknown>[] = [],
): Record<string, unknown> => ({
  subjectUri: 'file:///sample',
  revision: 'content-hash.sha256:sample',
  dataSources: contracts.map(contract => ({ contract, major: 1 })),
  traits: traits.map(id => ({ id, state: 'available' })),
  operations,
})

const PNG = descriptorWith(
  [
    'common.view/raster-image-source',
    'common.view/tree-data-source',
    'common.view/byte-range-source',
  ],
  ['image.raster', 'content.binary'],
)

const ZIP = descriptorWith(
  [
    'common.view/namespace-entry-source',
    'common.view/tree-data-source',
    'common.view/byte-range-source',
  ],
  ['container.entries'],
  [
    { id: 'view.inspect', handlerId: 'inspect', mutatesSource: false, state: 'available' },
    { id: 'export.raw', handlerId: 'export-raw', mutatesSource: false, state: 'available' },
    {
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      state: 'available',
    },
  ],
)

/** The stage list the renderer builds, minus the modules the policy binds to each slot. */
const ALL: readonly StageFacts[] = [
  stage('hex', 'common.view/byte-range-source'),
  stage('tree', 'common.view/tree-data-source'),
  stage('image', 'common.view/raster-image-source'),
  stage('image-edit', 'common.view/raster-image-source'),
  stage('archive', 'common.view/namespace-entry-source'),
  stage('code', 'common.view/text-data-source'),
  stage('audio', 'common.view/audio-media-source'),
]

describe('stage ordering', () => {
  it('puts every stage in the app policy order regardless of input order', () => {
    const ordered = orderStages(ALL).map(item => item.id)
    expect(ordered).toEqual(['code', 'image', 'image-edit', 'audio', 'archive', 'tree', 'hex'])
    for (let index = 1; index < ordered.length; index += 1) {
      const before = STAGE_ORDER.indexOf(String(ordered[index - 1]))
      expect(before).toBeLessThan(STAGE_ORDER.indexOf(String(ordered[index])))
    }
  })

  it('refuses a stage the policy does not rank, instead of dropping it silently', () => {
    expect(() => orderStages([stage('surprise', 'common.view/byte-range-source')])).toThrow(
      /not ranked/u,
    )
  })

  it('refuses two stages claiming the same slot', () => {
    expect(() => orderStages([stage('hex', 'a'), stage('hex', 'b')])).toThrow(/duplicate stage/u)
  })
})

describe('applicability', () => {
  it('offers every stage whose data source the subject publishes, not one per singleton group', () => {
    const offered = applicableStages(orderStages(ALL), PNG).map(item => item.id)
    // The host's presentation plan keeps one `center-stage`; the picker must keep all of them.
    expect(offered).toEqual(['image', 'image-edit', 'tree', 'hex'])
  })

  it('drops a stage whose declared trait the descriptor does not report', () => {
    const stages = [stage('vector', 'common.view/vector-scene-source', 'vector.scene')]
    const published = descriptorWith(['common.view/vector-scene-source'])
    expect(applicableStages(stages, published)).toEqual([])
    const observed = descriptorWith(['common.view/vector-scene-source'], ['vector.scene'])
    expect(applicableStages(stages, observed).map(item => item.id)).toEqual(['vector'])
  })

  it('offers the archive stage exactly for a subject that publishes a namespace', () => {
    expect(applicableStages(orderStages(ALL), ZIP).map(item => item.id)).toEqual([
      'archive',
      'tree',
      'hex',
    ])
  })

  it('reads published contracts from a descriptor and tolerates a malformed one', () => {
    expect(publishedContracts(PNG)).toContain('common.view/raster-image-source')
    expect(publishedContracts({})).toEqual([])
    expect(descriptorOperations({})).toEqual([])
  })
})

describe('inspector panels', () => {
  it('always offers the descriptor-only panels', () => {
    expect(applicablePanels(PNG).map(panel => panel.id)).toEqual([
      'operations',
      'metadata',
      'properties',
      'diagnostics',
    ])
  })

  it('adds the transport bar only when a transport source is published', () => {
    const media = descriptorWith(['common.view/video-media-source', 'common.view/transport-source'])
    expect(applicablePanels(media).map(panel => panel.id)).toContain('transport')
  })
})

describe('archive entry extraction', () => {
  it('picks only the standard container member operation', () => {
    expect(entryPreviewOperations(ZIP)).toEqual(['container.extract'])
  })

  it('never offers a mutating or unavailable operation', () => {
    const guarded = descriptorWith(
      [],
      [],
      [
        { id: 'org.x/write', handlerId: 'w', mutatesSource: true, state: 'available' },
        { id: 'org.x/off', handlerId: 'o', mutatesSource: false, state: 'disabled' },
        {
          id: 'org.example/archive.extract-entry',
          handlerId: 'local-lookalike',
          mutatesSource: false,
          state: 'available',
        },
      ],
    )
    expect(entryPreviewOperations(guarded)).toEqual([])
  })
})

describe('the stage that opens first', () => {
  it('keeps the host plan choice when it survived applicability', () => {
    expect(preferredStage(['image', 'tree', 'hex'], 'tree')).toBe('tree')
  })

  it('falls back to the first stage in policy order when the plan choice did not', () => {
    expect(preferredStage(['image', 'tree'], 'vector')).toBe('image')
    expect(preferredStage(['image', 'tree'], undefined)).toBe('image')
    expect(preferredStage([], 'image')).toBeUndefined()
  })
})

describe('the self-test line', () => {
  it('is the shape the run is read by', () => {
    expect(selfTestLine('sample.png', ['image', 'hex'], true)).toBe(
      'selftest: sample.png -> views [image, hex] mounted=true',
    )
  })
})

describe('namespace indexing', () => {
  const page = (items: readonly NamespaceEntry[], nextCursor?: string): Page<NamespaceEntry> =>
    ({ items, ...(nextCursor === undefined ? {} : { nextCursor }) }) as Page<NamespaceEntry>

  const entry = (path: string, kind: 'file' | 'directory'): NamespaceEntry =>
    ({ id: `id:${path}`, path, name: path.split('/').slice(-1)[0], kind, revision: 'r' }) as never

  it('maps every file entry id to its path, descending into directories', async () => {
    const index = await indexNamespace({
      async list(prefix) {
        if (prefix === '') return page([entry('readme.txt', 'file'), entry('data', 'directory')])
        if (prefix === 'data') return page([entry('data/values.csv', 'file')])
        return page([])
      },
    })
    expect([...index.keys()].sort()).toEqual(['id:data/values.csv', 'id:readme.txt'])
    expect(index.get('id:data/values.csv')?.path).toBe('data/values.csv')
  })

  it('follows the cursor of a paged listing', async () => {
    const index = await indexNamespace({
      async list(_prefix, request) {
        return request.cursor === undefined
          ? page([entry('a', 'file')], 'next')
          : page([entry('b', 'file')])
      },
    })
    expect([...index.keys()].sort()).toEqual(['id:a', 'id:b'])
  })

  it('lists each prefix once even when a source returns the prefix directory itself', async () => {
    // The first-party ZIP namespace filters by `startsWith`, so `list('data/')` includes `data/`.
    const prefixes: string[] = []
    const index = await indexNamespace({
      async list(prefix) {
        prefixes.push(prefix)
        if (prefix === '') return page([entry('data/', 'directory'), entry('readme.txt', 'file')])
        return page([entry('data/', 'directory'), entry('data/values.csv', 'file')])
      },
    })
    expect(prefixes).toEqual(['', 'data/'])
    expect([...index.keys()].sort()).toEqual(['id:data/values.csv', 'id:readme.txt'])
  })

  it('stops descending at the depth bound instead of following a hostile tree forever', async () => {
    let deepest = 0
    const index = await indexNamespace({
      async list(prefix) {
        const depth = prefix === '' ? 0 : prefix.split('/').length
        deepest = Math.max(deepest, depth)
        return page([
          entry(`${prefix === '' ? '' : `${prefix}/`}f${depth}`, 'file'),
          entry(`${prefix === '' ? '' : `${prefix}/`}d${depth}`, 'directory'),
        ])
      },
    })
    expect(deepest).toBeLessThanOrEqual(NAMESPACE_MAXIMUM_DEPTH)
    expect(index.size).toBeLessThanOrEqual(NAMESPACE_MAXIMUM_DEPTH + 1)
  })
})
