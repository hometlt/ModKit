import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  PWA_FILESYSTEM_READ_RANDOM,
  PWA_HOST_FACILITY_UNAVAILABLE,
  createPwaFormatSmokeAcceptance,
  loadPwaFormatSmokeAuthority,
  validatePwaFormatSmokeAuthority,
  type FormatSmokeAuthority,
  type FormatSmokeAuthorityCase,
  type PwaFormatSmokeBridge,
  type PwaFormatSmokeStageEvidence,
} from '../src/format-smoke.js'
import {
  WEB_SOURCE_OPEN_BOUNDARY,
  createWebSourceOpenAdapter,
  type WebSc2CascSourceOpenRequest,
} from '../src/source-open.js'

const authorityPath = resolve(
  import.meta.dirname,
  '..',
  '..',
  'vscode',
  'generated',
  'format-smoke.v1.json',
)

const authorityBytes = readFileSync(authorityPath)
const authoritySha256 = `sha256:${createHash('sha256').update(authorityBytes).digest('hex')}`
const authority = validatePwaFormatSmokeAuthority(
  JSON.parse(authorityBytes.toString('utf8')) as unknown,
)

const evidence = (testCase: FormatSmokeAuthorityCase): PwaFormatSmokeStageEvidence => {
  if (testCase.stage === 'raster') {
    return { kind: 'raster', width: 4, height: 4, opaquePixels: 4, metadataEntries: 2 }
  }
  if (testCase.stage === 'tree-text') {
    return { kind: 'tree-text', treeNodes: 2, textCharacters: 20 }
  }
  if (testCase.stage === 'tree') return { kind: 'tree', treeNodes: 2 }
  if (testCase.stage === 'metadata-tree') {
    return { kind: 'metadata-tree', metadataEntries: 2, treeNodes: 2 }
  }
  return { kind: 'model-or-wireframe', renderer: 'wireframe', width: 320, height: 200 }
}

const sourceRequest = (testCase: FormatSmokeAuthorityCase): WebSc2CascSourceOpenRequest => {
  const terminal = testCase.route.at(-1)
  if (
    testCase.corpus.kind !== 'sc2-casc-entry' ||
    typeof testCase.corpus.path !== 'string' ||
    typeof testCase.corpus.sha256 !== 'string' ||
    typeof testCase.corpus.bytes !== 'number' ||
    terminal === undefined
  ) {
    throw new TypeError('test case is not an SC2/CASC source request')
  }
  return {
    requestId: testCase.id,
    source: {
      kind: testCase.corpus.kind,
      entryPath: testCase.corpus.path,
      contentSha256: testCase.corpus.sha256,
      bytes: testCase.corpus.bytes,
    },
    requestedFormatId: terminal.formatId,
  }
}

const browserSourceOpen = createWebSourceOpenAdapter({
  realmId: 'modkit.app.web/main',
  facilities: ['network.range-fetch'],
})

const bridge = (
  descriptor: FormatSmokeAuthority = authority,
  mutateRoute: (
    testCase: FormatSmokeAuthorityCase,
  ) => FormatSmokeAuthorityCase['route'] = testCase => testCase.route,
  onHostOnlySource: (testCase: FormatSmokeAuthorityCase) => void = () => undefined,
): PwaFormatSmokeBridge => ({
  async preparePackages() {
    return { reloadRequired: false }
  },
  async runtimeIdentity() {
    return {
      offlineCatalogSha256: descriptor.generatedFrom.offlineRelease.catalogSha256,
      loadedManagedRoots: descriptor.generatedFrom.offlineRelease.roots,
      codecContributionCount: descriptor.generatedFrom.codecContributionCount,
      packages: descriptor.generatedFrom.offlineRelease.packageIds.map((id, index) => ({
        id,
        version: '0.1.0',
        digest: String(index).padStart(64, '0'),
        enabled: true,
      })),
    }
  },
  async open(testCase) {
    return {
      selectedRoute: mutateRoute(testCase),
      corpus: {
        bytes: testCase.corpus.bytes ?? 0,
        sha256: testCase.corpus.sha256 ?? ''.padStart(64, '0'),
        verifiedBeforeOpen: true,
      },
      stage: evidence(testCase),
    }
  },
  async openHostOnlySource(testCase) {
    onHostOnlySource(testCase)
    return browserSourceOpen.openSc2CascEntry(sourceRequest(testCase))
  },
})

const corpusUrls = Object.fromEntries(
  authority.cases
    .filter(
      testCase =>
        testCase.runtime.pwa.kind === 'browser-subset' &&
        testCase.corpus.kind !== 'named-exclusion',
    )
    .map(testCase => [testCase.id, `http://127.0.0.1/corpus/${testCase.id}/C:%5Csecret.bin`]),
)

describe('PWA installed format-family acceptance', () => {
  it('consumes the exact generated 14-case authority bytes with a real ODT corpus', async () => {
    const loaded = await loadPwaFormatSmokeAuthority(
      'https://example.invalid/format-smoke.v1.json',
      authoritySha256,
      async () => new Response(authorityBytes),
    )

    expect(loaded.sha256).toBe(authoritySha256)
    expect(loaded.authority.cases).toHaveLength(14)
    expect(
      loaded.authority.cases.filter(
        testCase =>
          testCase.runtime.pwa.kind === 'browser-subset' &&
          testCase.corpus.kind !== 'named-exclusion',
      ),
    ).toHaveLength(10)
    expect(
      loaded.authority.cases.filter(
        testCase => testCase.runtime.pwa.kind === 'host-facility-refusal',
      ),
    ).toHaveLength(4)
    expect(loaded.authority.namedExclusions).toEqual([])
  })

  it('gets the typed refusal from the page-owned SC2/CASC source-open boundary', async () => {
    const testCase = authority.cases.find(item => item.id === 'audio-wav')
    expect(testCase).toBeDefined()
    await expect(
      browserSourceOpen.openSc2CascEntry(sourceRequest(testCase as FormatSmokeAuthorityCase)),
    ).rejects.toMatchObject(
      expect.objectContaining({
        code: PWA_HOST_FACILITY_UNAVAILABLE,
        context: expect.objectContaining({
          boundary: WEB_SOURCE_OPEN_BOUNDARY,
          facility: PWA_FILESYSTEM_READ_RANDOM,
          requestId: 'audio-wav',
          sourceKind: 'sc2-casc-entry',
          contentSha256: testCase?.corpus.sha256,
          bytes: testCase?.corpus.bytes,
          requestedFormatId: 'wav',
        }),
      }),
    )
    const advertisedWithoutAdapter = createWebSourceOpenAdapter({
      realmId: 'modkit.app.web/main',
      facilities: [PWA_FILESYSTEM_READ_RANDOM, 'network.range-fetch'],
    })
    await expect(
      advertisedWithoutAdapter.openSc2CascEntry(
        sourceRequest(testCase as FormatSmokeAuthorityCase),
      ),
    ).rejects.toMatchObject({ code: 'x3.host/source-adapter-unavailable' })
  })

  it('records 10 actual opens, 4 actual refusals and no exclusions', async () => {
    const hostOnlyRequests: FormatSmokeAuthorityCase[] = []
    const control = createPwaFormatSmokeAcceptance({
      authority,
      authoritySha256,
      bridge: bridge(
        authority,
        testCase => testCase.route,
        testCase => hostOnlyRequests.push(testCase),
      ),
    })
    const receipt = await control.run(corpusUrls)

    expect(receipt.verdict).toBe('pass')
    expect(receipt.cases.filter(item => item.outcome === 'opened')).toHaveLength(10)
    expect(receipt.cases.filter(item => item.outcome === 'refused')).toHaveLength(4)
    expect(hostOnlyRequests.map(item => item.id)).toEqual([
      'casc-dds',
      'audio-wav',
      'audio-ogg',
      'model-m3',
    ])
    expect(new Set(hostOnlyRequests.map(item => item.corpus.path)).size).toBe(4)
    for (const item of receipt.cases.filter(item => item.outcome === 'refused')) {
      const generated = authority.cases.find(testCase => testCase.id === item.id)
      expect(item.source).toEqual({
        boundary: WEB_SOURCE_OPEN_BOUNDARY,
        kind: 'sc2-casc-entry',
        contentSha256: generated?.corpus.sha256,
        bytes: generated?.corpus.bytes,
        requestedFormatId: generated?.route.at(-1)?.formatId,
      })
    }
    expect(receipt.cases.filter(item => item.outcome === 'excluded')).toEqual([])
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toMatch(/(?:file:|https?:|[A-Z]:[\\/]|\\\\)/u)
    expect(serialized).not.toContain('secret.bin')
  })

  it('fails when the product-observed selected route differs from generated authority', async () => {
    const control = createPwaFormatSmokeAcceptance({
      authority,
      authoritySha256,
      bridge: bridge(authority, testCase =>
        testCase.id === 'archive-mpq'
          ? [
              {
                formatId: testCase.route[0]?.formatId ?? 'invalid',
                extensionId: 'wrong/owner',
                contributionId: 'wrong/contribution',
              },
            ]
          : testCase.route,
      ),
    })

    const receipt = await control.run(corpusUrls)
    expect(receipt.verdict).toBe('fail')
    expect(receipt.cases.find(item => item.id === 'archive-mpq')).toMatchObject({
      outcome: 'opened',
      verdict: 'fail',
    })
  })
})
