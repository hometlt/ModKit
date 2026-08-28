import { describe, expect, it } from 'vitest'
import { MAP_PREVIEW_PREPARATION_CONTRACT } from '@modkitx-x3/sdk/maps'
import {
  STARCRAFT2_MAP_PREVIEW_PREPARATION_ID,
  createProvider,
  prepareStarcraft2MapPreview,
} from '../src/map-preview-provider.js'

const entry = (path: string, kind: 'file' | 'directory' = 'file') => ({
  path,
  kind,
  ...(kind === 'file' ? { size: '42' } : {}),
})

const mapEntries = (root: string) => [
  entry(`${root}/Objects`),
  entry(`${root}/Regions`),
  entry(`${root}/t3HeightMap`),
]

const subject = (
  entries: readonly ReturnType<typeof entry>[],
  options: Readonly<{
    formatId?: string
    namespaceState?: 'unavailable' | 'complete' | 'truncated'
    namespaceSource?: boolean
    extraction?: boolean
  }> = {},
) => ({
  schemaVersion: 1 as const,
  subjectUri:
    options.formatId === 'sc2-map'
      ? 'file:///fixtures/One.SC2Map'
      : 'file:///fixtures/StarCraft%20II',
  revision: 'content-hash.sha256:fixture-sc2',
  formatId: options.formatId ?? 'casc',
  traits: ['container.entries'],
  dataSources:
    options.namespaceSource === false
      ? []
      : [{ contract: 'common.view/namespace-entry-source', major: 1 }],
  operations: options.extraction === false ? [] : [{ id: 'container.extract', state: 'available' }],
  namespace: { state: options.namespaceState ?? ('complete' as const), entries },
})

const request = (
  entries: readonly ReturnType<typeof entry>[],
  options: Parameters<typeof subject>[1] = {},
  selectionId?: string,
) => ({
  subject: subject(entries, options),
  ...(selectionId === undefined ? {} : { selectionId }),
  maxCandidates: 16,
  maxRoots: 8,
  maxDepth: 8,
})

describe('StarCraft II map preview preparation', () => {
  it('publishes the stable preparation port for casc and conditional sc2-map subjects', async () => {
    const lease = await createProvider({
      contract: MAP_PREVIEW_PREPARATION_CONTRACT,
      major: 1,
    })

    expect(Object.keys(lease.value).sort()).toEqual([
      'contract',
      'preparationId',
      'prepare',
      'subjectFormatIds',
    ])
    expect(lease.value).toMatchObject({
      contract: MAP_PREVIEW_PREPARATION_CONTRACT,
      preparationId: STARCRAFT2_MAP_PREVIEW_PREPARATION_ID,
      subjectFormatIds: ['casc', 'sc2-map'],
    })
    await lease.release()
    expect(() => createProvider({ contract: 'common.map/resolved-workspace', major: 1 })).toThrow(
      'unsupported StarCraft II map-preview preparation selection',
    )
  })

  it('is not applicable to another format or a complete namespace without a proved map root', async () => {
    const wrongFormat = await prepareStarcraft2MapPreview(
      request([], { formatId: 'warzone-wz', namespaceSource: false, extraction: false }),
    )
    expect(wrongFormat).toMatchObject({
      state: 'not-applicable',
      diagnostics: [{ code: expect.stringMatching(/format-not-applicable$/u) }],
    })

    const incomplete = await prepareStarcraft2MapPreview(
      request([
        entry('campaigns/liberty.sc2campaign/base.sc2maps/maps/example.sc2map/objects'),
        entry('campaigns/liberty.sc2campaign/base.sc2maps/maps/example.sc2map/regions'),
      ]),
    )
    expect(incomplete).toMatchObject({
      state: 'not-applicable',
      diagnostics: [{ code: expect.stringMatching(/map-absent$/u) }],
    })
  })

  it('prepares one installed CASC map with an exact logical-root namespace remap', async () => {
    const root = 'Campaigns/Liberty.SC2Campaign/Base.SC2Maps/Maps/Campaign/TArcade.SC2Map'
    const result = await prepareStarcraft2MapPreview(
      request([
        entry(`${root}\\Objects`),
        entry(`${root}/Regions`),
        entry(`${root}/t3HeightMap`),
        entry(`${root}/Base.SC2Data/GameData/UnitData.xml`),
      ]),
    )

    expect(result.state).toBe('prepared')
    if (result.state !== 'prepared') throw new Error('single installed map did not prepare')
    const normalizedRoot = root.toLowerCase()
    expect(result.plan).toMatchObject({
      schemaVersion: 1,
      workspace: {
        gameId: 'org.modkitx/starcraft-2',
        activeRootId: 'map',
        sources: [
          {
            sourceId: 'starcraft2-opened-subject',
            kind: 'casc-subject',
            location: 'map-preview:opened-subject',
          },
        ],
        roots: [
          {
            rootId: 'map',
            sourceId: 'starcraft2-opened-subject',
            sourcePath: normalizedRoot,
            displayName: 'tarcade.sc2map',
            kind: 'map',
            dependencies: [],
          },
        ],
        maxRoots: 1,
        maxDepth: 1,
      },
      resources: {
        schemaVersion: 1,
        strategy: 'subject-namespace',
        roots: [{ rootId: 'map', namespacePrefix: normalizedRoot }],
      },
    })
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: expect.stringMatching(/dependency-resolver-remainder$/u) }),
    )
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('requires an opaque deterministic selection for multiple complete roots', async () => {
    const alpha = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/alpha.sc2map'
    const zulu = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/zulu.sc2map'
    const entries = [...mapEntries(zulu), ...mapEntries(alpha)]
    const selection = await prepareStarcraft2MapPreview(request(entries))
    expect(selection.state).toBe('selection-required')
    if (selection.state !== 'selection-required') throw new Error('selection was not requested')
    expect(selection.candidates.map(candidate => candidate.sourcePath)).toEqual([alpha, zulu])
    expect(
      selection.candidates.every(candidate => !candidate.candidateId.includes('.sc2map')),
    ).toBe(true)

    const reordered = await prepareStarcraft2MapPreview(request([...entries].reverse()))
    expect(reordered).toMatchObject({
      state: 'selection-required',
      candidates: selection.candidates,
    })
    const chosen = selection.candidates[1]
    const prepared = await prepareStarcraft2MapPreview(request(entries, {}, chosen.candidateId))
    expect(prepared).toMatchObject({
      state: 'prepared',
      plan: {
        workspace: { roots: [{ sourcePath: zulu }] },
        resources: { roots: [{ rootId: 'map', namespacePrefix: zulu }] },
      },
    })

    const unknown = await prepareStarcraft2MapPreview(request(entries, {}, 'sc2-map:not-issued'))
    expect(unknown).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/selection-invalid$/u) }],
    })
  })

  it('never guesses from a truncated CASC listing but accepts a selected fully proved root', async () => {
    const root = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/tarcade.sc2map'
    const complete = await prepareStarcraft2MapPreview(request(mapEntries(root)))
    expect(complete.state).toBe('prepared')
    if (complete.state !== 'prepared') throw new Error('complete root did not prepare')

    const truncated = await prepareStarcraft2MapPreview(
      request(mapEntries(root), { namespaceState: 'truncated' }),
    )
    expect(truncated).toMatchObject({
      state: 'selection-required',
      candidates: [{ sourcePath: root }],
      diagnostics: [{ code: expect.stringMatching(/truncated-selection-required$/u) }],
    })
    if (truncated.state !== 'selection-required') {
      throw new Error('truncated root did not require selection')
    }
    const selected = await prepareStarcraft2MapPreview(
      request(
        mapEntries(root),
        { namespaceState: 'truncated' },
        truncated.candidates[0].candidateId,
      ),
    )
    expect(selected).toMatchObject({
      state: 'prepared',
      diagnostics: [
        { code: expect.stringMatching(/truncated-selection-confirmed$/u) },
        { code: expect.stringMatching(/dependency-resolver-remainder$/u) },
      ],
    })

    const noProof = await prepareStarcraft2MapPreview(
      request([entry(`${root}/objects`)], { namespaceState: 'truncated' }),
    )
    expect(noProof).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/prefix-discovery-required$/u) }],
    })
  })

  it('prepares a standalone namespace root only when the codec really exposes extraction', async () => {
    const entries = [entry('MapObjects'), entry('Regions'), entry('MapHeightMap')]
    const unavailable = await prepareStarcraft2MapPreview(
      request(entries, { formatId: 'sc2-map', extraction: false }),
    )
    expect(unavailable).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/standalone-extraction-unavailable$/u) }],
    })

    const prepared = await prepareStarcraft2MapPreview(request(entries, { formatId: 'sc2-map' }))
    expect(prepared.state).toBe('prepared')
    if (prepared.state !== 'prepared') throw new Error('extractable standalone map did not prepare')
    expect(prepared.plan).toMatchObject({
      workspace: {
        roots: [
          {
            sourcePath: expect.stringMatching(/^opened\/[0-9a-f]{16}\.sc2map$/u),
            displayName: 'One.SC2Map',
          },
        ],
      },
      resources: {
        strategy: 'subject-namespace',
        roots: [{ rootId: 'map', namespacePrefix: '' }],
      },
    })
  })

  it('fails closed on missing capabilities, candidate overflow and unsafe paths', async () => {
    const root = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/one.sc2map'
    const missingNamespace = await prepareStarcraft2MapPreview(
      request(mapEntries(root), { namespaceSource: false }),
    )
    expect(missingNamespace).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/namespace-unavailable$/u) }],
    })

    const missingExtract = await prepareStarcraft2MapPreview(
      request(mapEntries(root), { extraction: false }),
    )
    expect(missingExtract).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/extraction-unavailable$/u) }],
    })

    const overflow = await prepareStarcraft2MapPreview({
      ...request([
        ...mapEntries(root),
        ...mapEntries('campaigns/liberty.sc2campaign/base.sc2maps/maps/two.sc2map'),
      ]),
      maxCandidates: 1,
    })
    expect(overflow).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/candidate-budget-exceeded$/u) }],
    })

    const unsafe = await prepareStarcraft2MapPreview(
      request([...mapEntries('../escape.sc2map'), ...mapEntries(root)]),
    )
    expect(unsafe).toMatchObject({
      state: 'prepared',
      diagnostics: [
        { code: expect.stringMatching(/namespace-paths-refused$/u) },
        { code: expect.stringMatching(/dependency-resolver-remainder$/u) },
      ],
    })
  })
})
