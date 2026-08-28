import { describe, expect, it } from 'vitest'
import { MAP_PREVIEW_PREPARATION_CONTRACT } from '@modkitx-x3/sdk/maps'
import {
  WARZONE_MAP_PREVIEW_PREPARATION_ID,
  WARZONE_MAP_PREVIEW_RESOLVER_ID,
  createProvider,
  prepareWarzoneMapPreview,
} from '../src/map-preview-provider.js'

const entry = (path: string, kind: 'file' | 'directory' = 'file') => ({
  path,
  kind,
  ...(kind === 'file' ? { size: '42' } : {}),
})

const subject = (
  entries: readonly ReturnType<typeof entry>[],
  state: 'unavailable' | 'complete' | 'truncated' = 'complete',
  formatId = 'warzone-wz',
) => ({
  schemaVersion: 1 as const,
  subjectUri: 'memory://fixtures/mp.wz',
  revision: 'content-hash.sha256:fixture-mp-wz',
  formatId,
  traits: ['container.entries'],
  dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
  operations: [{ id: 'container.extract', state: 'available' }],
  namespace: { state, entries },
})

const request = (entries: readonly ReturnType<typeof entry>[], selectionId?: string) => ({
  subject: subject(entries),
  ...(selectionId === undefined ? {} : { selectionId }),
  maxCandidates: 16,
  maxRoots: 8,
  maxDepth: 8,
})

describe('Warzone 2100 map preview preparation', () => {
  it('publishes only the stable preparation port for warzone-wz subjects', async () => {
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
      preparationId: WARZONE_MAP_PREVIEW_PREPARATION_ID,
      subjectFormatIds: ['warzone-wz'],
    })
    await lease.release()
    expect(() => createProvider({ contract: 'common.map/resolved-workspace', major: 1 })).toThrow(
      'unsupported Warzone map-preview preparation selection',
    )
  })

  it('is not applicable to another subject format or a complete package without maps', async () => {
    const wrongFormat = await prepareWarzoneMapPreview({
      ...request([]),
      subject: subject([], 'complete', 'zip'),
    })
    expect(wrongFormat).toMatchObject({
      state: 'not-applicable',
      diagnostics: [{ code: expect.stringMatching(/format-not-applicable$/u) }],
    })

    const empty = await prepareWarzoneMapPreview(request([entry('stats/templates.json')]))
    expect(empty).toMatchObject({
      state: 'not-applicable',
      diagnostics: [{ code: expect.stringMatching(/map-absent$/u) }],
    })
  })

  it('refuses unavailable and truncated namespaces because candidate selection would be incomplete', async () => {
    for (const state of ['unavailable', 'truncated'] as const) {
      const result = await prepareWarzoneMapPreview({
        ...request([]),
        subject: subject([entry('multiplay/maps/visible/game.map')], state),
      })
      expect(result).toMatchObject({
        state: 'unresolved',
        diagnostics: [
          {
            code: expect.stringMatching(/namespace-incomplete$/u),
            data: { namespaceState: state },
          },
        ],
      })
    }
  })

  it('requires both bounded namespace facts and extraction before preparing a mounted map root', async () => {
    const base = request([entry('multiplay/maps/one/game.map')])
    const withoutNamespaceSource = await prepareWarzoneMapPreview({
      ...base,
      subject: { ...base.subject, dataSources: [] },
    })
    expect(withoutNamespaceSource).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/namespace-unavailable$/u) }],
    })

    const withoutExtraction = await prepareWarzoneMapPreview({
      ...base,
      subject: { ...base.subject, operations: [] },
    })
    expect(withoutExtraction).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/extraction-unavailable$/u) }],
    })
  })

  it('prepares one map as map -> mp -> base with exact subject and external root coverage', async () => {
    const result = await prepareWarzoneMapPreview(
      request([
        entry('multiplay/maps/2c-highground/game.map'),
        entry('multiplay/maps/2c-highground/struct.json'),
      ]),
    )

    expect(result.state).toBe('prepared')
    if (result.state !== 'prepared') throw new Error('single map did not prepare')
    expect(result.plan.workspace).toMatchObject({
      gameId: 'org.modkitx/warzone-2100',
      activeRootId: 'map',
      roots: [
        { rootId: 'base', sourcePath: 'base', dependencies: [] },
        {
          rootId: 'mp',
          sourcePath: 'mp',
          dependencies: [{ targetRootId: 'base', ref: 'base.wz' }],
        },
        {
          rootId: 'map',
          sourcePath: 'multiplay/maps/2c-highground',
          dependencies: [{ targetRootId: 'mp', ref: 'mp.wz' }],
        },
      ],
      maxRoots: 3,
      maxDepth: 2,
    })
    expect(result.plan.resources).toEqual({
      schemaVersion: 1,
      strategy: 'host-resolved',
      resolverId: WARZONE_MAP_PREVIEW_RESOLVER_ID,
      subjectNamespaceRoots: [{ rootId: 'map', namespacePrefix: 'multiplay/maps/2c-highground' }],
      roots: [
        {
          rootId: 'mp',
          locator: {
            schemaVersion: 1,
            kind: 'game-installation-archive',
            gameId: 'org.modkitx/warzone-2100',
            archiveRelativePaths: ['data/mp.wz', 'mp.wz'],
            openedSubjectPolicy: 'prefer-matching-opened-subject',
          },
        },
        {
          rootId: 'base',
          locator: expect.objectContaining({
            archiveRelativePaths: ['data/base.wz', 'base.wz'],
            openedSubjectPolicy: 'installation-only',
          }),
        },
      ],
    })
    const covered = new Set([
      ...result.plan.resources.subjectNamespaceRoots.map(root => root.rootId),
      ...result.plan.resources.roots.map(root => root.rootId),
    ])
    expect(covered).toEqual(new Set(result.plan.workspace.roots.map(root => root.rootId)))
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: expect.stringMatching(/external-resolver-required$/u) }),
    )
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('requires explicit selection for multiple maps and validates a stateless opaque id', async () => {
    const entries = [entry('multiplay/maps/zulu/game.map'), entry('multiplay/maps/alpha/game.map')]
    const selection = await prepareWarzoneMapPreview(request(entries))
    expect(selection.state).toBe('selection-required')
    if (selection.state !== 'selection-required') throw new Error('selection was not requested')
    expect(selection.candidates.map(candidate => candidate.sourcePath)).toEqual([
      'multiplay/maps/alpha',
      'multiplay/maps/zulu',
    ])
    expect(selection.candidates.every(candidate => !candidate.candidateId.includes('maps/'))).toBe(
      true,
    )

    const reordered = await prepareWarzoneMapPreview(request([...entries].reverse()))
    expect(reordered).toMatchObject({
      state: 'selection-required',
      candidates: selection.candidates,
    })
    const chosen = selection.candidates[1]
    const prepared = await prepareWarzoneMapPreview(request(entries, chosen.candidateId))
    expect(prepared).toMatchObject({
      state: 'prepared',
      plan: {
        workspace: { roots: [{}, {}, { sourcePath: 'multiplay/maps/zulu' }] },
        resources: {
          subjectNamespaceRoots: [{ rootId: 'map', namespacePrefix: 'multiplay/maps/zulu' }],
        },
      },
    })

    const unknown = await prepareWarzoneMapPreview(request(entries, 'wz-map:not-issued'))
    expect(unknown).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/selection-invalid$/u) }],
    })
  })

  it('fails closed when two map roots differ only by case', async () => {
    const result = await prepareWarzoneMapPreview(
      request([
        entry('multiplay/maps/CaseSensitive/game.map'),
        entry('multiplay/maps/casesensitive/game.map'),
      ]),
    )
    expect(result).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/candidate-collision$/u) }],
    })
  })

  it('fails closed when candidates, roots or dependency depth exceed caller bounds', async () => {
    const entries = [entry('multiplay/maps/one/game.map'), entry('multiplay/maps/two/game.map')]
    const candidates = await prepareWarzoneMapPreview({ ...request(entries), maxCandidates: 1 })
    expect(candidates).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: expect.stringMatching(/candidate-budget-exceeded$/u) }],
    })

    for (const limits of [{ maxRoots: 2 }, { maxDepth: 1 }]) {
      const result = await prepareWarzoneMapPreview({
        ...request([entry('multiplay/maps/one/game.map')]),
        ...limits,
      })
      expect(result).toMatchObject({
        state: 'unresolved',
        diagnostics: [{ code: expect.stringMatching(/workspace-budget-exceeded$/u) }],
      })
    }
  })

  it('ignores unsafe archive paths with an aggregate diagnostic and never mounts them', async () => {
    const result = await prepareWarzoneMapPreview(
      request([entry('../multiplay/maps/escape/game.map'), entry('multiplay/maps/safe/game.map')]),
    )
    expect(result).toMatchObject({
      state: 'prepared',
      plan: { workspace: { roots: [{}, {}, { sourcePath: 'multiplay/maps/safe' }] } },
      diagnostics: [{ code: expect.stringMatching(/namespace-paths-refused$/u) }, {}],
    })
  })
})
