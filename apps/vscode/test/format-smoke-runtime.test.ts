import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  FORMAT_SMOKE_CASE_IDS,
  assertFormatSmokeWebviewResult,
  formatSmokeContainerUri,
  loadFormatSmokeAuthority,
  parseFormatSmokeContainerUri,
  resolveFormatSmokeCases,
  verifyFormatSmokeCorpusBeforeOpen,
} from '../test-e2e/format-smoke-runtime.mjs'
import type {
  FormatSmokeContainerSource,
  FormatSmokeFileSource,
  FormatSmokeOpenCase,
  FormatSmokeRouteStep,
  FormatSmokeVerificationCase,
  FormatSmokeWebviewObservation,
} from '../test-e2e/format-smoke-runtime.mjs'

const authority = loadFormatSmokeAuthority()
const scratch = mkdtempSync(join(tmpdir(), 'modkit-format-smoke-runtime-'))
const roots = {
  workspaceRoot: resolve(scratch, 'workspace'),
  sc2InstallRoot: resolve(scratch, 'StarCraft II'),
  warzoneInstallRoot: resolve(scratch, 'Warzone 2100'),
}
for (const root of Object.values(roots)) mkdirSync(root, { recursive: true })

const cases = resolveFormatSmokeCases(authority, roots)
const openCase = (id: string): FormatSmokeOpenCase => {
  const found = cases.find(entry => entry.id === id)
  if (found?.kind !== 'open') throw new TypeError(`${id} is not an open case`)
  return found
}

const fileCase = (id: string): FormatSmokeOpenCase & { readonly source: FormatSmokeFileSource } => {
  const testCase = openCase(id)
  if (testCase.source.kind !== 'file') throw new TypeError(`${id} is not a file source`)
  return { ...testCase, source: testCase.source }
}

const containerCase = (
  id: string,
): FormatSmokeOpenCase & { readonly source: FormatSmokeContainerSource } => {
  const testCase = openCase(id)
  if (testCase.source.kind !== 'container-entry') {
    throw new TypeError(`${id} is not a container entry source`)
  }
  return { ...testCase, source: testCase.source }
}

type ObservationFields = Omit<FormatSmokeWebviewObservation, 'caseId' | 'uri' | 'selectedRoute'>
type MutableObservation = Omit<FormatSmokeWebviewObservation, 'selectedRoute'> & {
  selectedRoute: FormatSmokeRouteStep[]
}

const observation = (
  testCase: FormatSmokeOpenCase,
  fields: ObservationFields,
): MutableObservation => ({
  caseId: testCase.id,
  uri: testCase.source.uri,
  selectedRoute: testCase.selectedRoute.map(step => ({ ...step })),
  ...fields,
})

describe('installed format-smoke runtime descriptor', () => {
  it('resolves the exact 14 generated cases and one named ODT exclusion', () => {
    expect(cases.map(entry => entry.id)).toEqual(FORMAT_SMOKE_CASE_IDS)
    expect(cases).toHaveLength(14)
    expect(cases.filter(entry => entry.kind === 'excluded')).toEqual([
      expect.objectContaining({
        id: 'document-odt',
        kind: 'excluded',
        reason: expect.stringContaining('No real ODT'),
      }),
    ])
  })

  it('uses confined file URIs for every loose and installation file', () => {
    for (const id of [
      'image-dds',
      'image-png',
      'image-tga',
      'image-jpeg',
      'data-xml',
      'archive-zip',
      'archive-warzone-wz',
      'archive-mpq',
    ]) {
      const testCase = fileCase(id)
      expect(testCase.source.kind, id).toBe('file')
      expect(testCase.source.uri, id).toBe(pathToFileURL(testCase.source.filePath).href)
    }
    expect(fileCase('archive-warzone-wz').source.filePath).toBe(
      join(roots.warzoneInstallRoot, 'data', 'mp.wz'),
    )
    expect(fileCase('archive-mpq').source.filePath).toBe(
      join(roots.sc2InstallRoot, 'Maps', 'ex', 'WTE70_Madlibrarian.SC2Map'),
    )
    expect(openCase('archive-mpq').selectedRoute).toEqual([
      {
        formatId: 'sc2-map',
        extensionId: 'blizzard/starcraft2',
        contributionId: 'blizzard/sc2-map',
      },
    ])
  })

  it('rejects an authority path that escapes its explicit root', () => {
    const escaped = structuredClone(authority)
    const corpus = escaped.cases[0].corpus
    if (!('path' in corpus)) throw new TypeError('the first fixture corpus must have a path')
    corpus.path = '../outside.dds'
    expect(() => resolveFormatSmokeCases(escaped, roots)).toThrow(/escapes its explicit root/u)

    corpus.path = resolve(scratch, 'absolute.dds')
    expect(() => resolveFormatSmokeCases(escaped, roots)).toThrow(/escapes its explicit root/u)
  })

  it('builds exact SC2-directory CASC and Warzone base.wz container URIs', () => {
    const casc = containerCase('casc-dds')
    expect(casc.source).toMatchObject({
      kind: 'container-entry',
      containerKind: 'sc2-casc',
      containerPath: roots.sc2InstallRoot,
    })
    expect(casc.source.uri).toBe(
      formatSmokeContainerUri(roots.sc2InstallRoot, casc.source.entryPath),
    )

    const pie = containerCase('model-warzone-pie')
    expect(pie.source).toMatchObject({
      kind: 'container-entry',
      containerKind: 'warzone-wz',
      containerPath: join(roots.warzoneInstallRoot, 'data', 'base.wz'),
      entryPath: 'components/bodies/cybd_run.pie',
    })
  })

  it('round-trips UTF-8 container paths through their lowercase hex URI token', () => {
    const containerPath = join(roots.sc2InstallRoot, 'Кампания Ω')
    const member = 'assets/textures/alpha2.dds'
    const uri = formatSmokeContainerUri(containerPath, member)
    expect(uri).toMatch(/^modkit-container:\/[0-9a-f]+\/assets\/textures\/alpha2\.dds$/u)
    expect(parseFormatSmokeContainerUri(uri)).toEqual({ containerPath, entryPath: member })
  })
})

describe('corpus verification before open', () => {
  it('accepts exact size and SHA-256 for a loose file', async () => {
    const bytes = Buffer.from('verified corpus')
    const filePath = join(scratch, 'verified.bin')
    writeFileSync(filePath, bytes)
    const testCase = {
      id: 'fixture-file',
      kind: 'open',
      source: {
        kind: 'file',
        filePath,
        uri: pathToFileURL(filePath).href,
        expectedBytes: bytes.length,
        expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    } satisfies FormatSmokeVerificationCase
    await expect(verifyFormatSmokeCorpusBeforeOpen(testCase)).resolves.toMatchObject({
      caseId: 'fixture-file',
      verifiedBeforeOpen: true,
      bytes: bytes.length,
    })
  })

  it('rejects a hash mismatch before returning the URI to an opener', async () => {
    const bytes = Buffer.from('wrong digest')
    const filePath = join(scratch, 'wrong.bin')
    writeFileSync(filePath, bytes)
    const testCase = {
      id: 'hash-mismatch',
      kind: 'open',
      source: {
        kind: 'file',
        filePath,
        uri: pathToFileURL(filePath).href,
        expectedBytes: bytes.length,
        expectedSha256: '0'.repeat(64),
      },
    } satisfies FormatSmokeVerificationCase
    await expect(verifyFormatSmokeCorpusBeforeOpen(testCase)).rejects.toThrow(
      /corpus SHA-256 mismatch/u,
    )
  })

  it('requires a read-only callback and verifies container entry bytes', async () => {
    const bytes = Buffer.from('container member')
    const testCase = {
      id: 'fixture-entry',
      kind: 'open',
      source: {
        kind: 'container-entry',
        containerKind: 'sc2-casc',
        containerPath: roots.sc2InstallRoot,
        entryPath: 'member.bin',
        uri: formatSmokeContainerUri(roots.sc2InstallRoot, 'member.bin'),
        expectedBytes: bytes.length,
        expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    } satisfies FormatSmokeVerificationCase
    await expect(verifyFormatSmokeCorpusBeforeOpen(testCase)).rejects.toThrow(
      /needs a readContainerEntry callback/u,
    )
    await expect(
      verifyFormatSmokeCorpusBeforeOpen(testCase, {
        readContainerEntry: async () => bytes,
      }),
    ).resolves.toMatchObject({ verifiedBeforeOpen: true, bytes: bytes.length })
  })
})

describe('pure webview stage assertions', () => {
  it('requires an exact generated contribution route', () => {
    const testCase = openCase('image-dds')
    const actual = observation(testCase, {
      raster: { width: 4, height: 4, opaquePixels: 16 },
      metadata: { entryCount: 3 },
    })
    const firstRoute = actual.selectedRoute[0]
    if (firstRoute === undefined) throw new TypeError('fixture route is empty')
    actual.selectedRoute = [{ ...firstRoute, contributionId: 'wrong/dds' }]
    expect(() => assertFormatSmokeWebviewResult(testCase, actual)).toThrow(
      /selected route mismatch/u,
    )
  })

  it('asserts raster opacity plus metadata', () => {
    const testCase = openCase('image-dds')
    expect(
      assertFormatSmokeWebviewResult(
        testCase,
        observation(testCase, {
          raster: { width: 4, height: 4, opaquePixels: 16 },
          metadata: { entryCount: 3 },
        }),
      ),
    ).toMatchObject({ verdict: 'pass', stage: 'raster' })
  })

  it('asserts tree-text, tree-only and audio metadata/tree stages', () => {
    const xml = openCase('data-xml')
    const zip = openCase('archive-zip')
    const wav = openCase('audio-wav')
    expect(
      assertFormatSmokeWebviewResult(
        xml,
        observation(xml, { tree: { nodeCount: 2 }, text: { characterCount: 20 } }),
      ).assertions,
    ).toEqual(['selected-route:exact', 'tree:nonempty', 'text:nonempty'])
    expect(
      assertFormatSmokeWebviewResult(zip, observation(zip, { tree: { nodeCount: 2 } })).verdict,
    ).toBe('pass')
    expect(
      assertFormatSmokeWebviewResult(
        wav,
        observation(wav, { metadata: { entryCount: 4 }, tree: { nodeCount: 2 } }),
      ).assertions,
    ).toContain('audio-tree:nonempty')
  })

  it('accepts a model canvas or an explicitly recorded wireframe fallback', () => {
    const m3 = openCase('model-m3')
    const pie = openCase('model-warzone-pie')
    expect(
      assertFormatSmokeWebviewResult(
        m3,
        observation(m3, { model: { canvas: { width: 640, height: 480 } } }),
      ).assertions,
    ).toContain('model-viewer:canvas')
    expect(
      assertFormatSmokeWebviewResult(
        pie,
        observation(pie, {
          model: { wireframeFallback: { recorded: true, segmentCount: 12 } },
        }),
      ).assertions,
    ).toContain('model-viewer:wireframe-fallback-recorded')
  })
})
