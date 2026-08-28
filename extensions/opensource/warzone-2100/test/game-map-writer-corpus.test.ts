import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ChangeSet,
  type ContributionContext,
  type ResourceBudget,
  type Writer,
} from '@modkitx-x3/sdk'
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from 'modkit-extension-x3-archives/formats/zip/codec'
import { applyWarzoneLastWins } from '../src/warzone-wz/codec.js'
import { createProvider as createMapProvider } from '../src/map-provider.js'
import { parseWarzoneGameMap } from '../src/warzone2100-map/format.js'
import { WARZONE_GAME_MAP_WRITE_INTENT } from '../src/warzone2100-map/writer.js'

const corpusRoot = process.env['MODKITX_WARZONE_ROOT']
const configured = typeof corpusRoot === 'string' && corpusRoot.length > 0
const archivePath = configured ? join(corpusRoot, 'data', 'mp.wz') : ''
const entryPath = 'multiplay/maps/2c-highground/game.map'
const entryDigest = 'c03e17c13a837339a1b8066047385758539cdc14ef903d806fcf871d30409111'
const budget: ResourceBudget = {
  maxInputBytes: 1_073_741_824n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 256 * 1024 * 1024,
  maxDiagnostics: 200,
}
const context: ContributionContext = {
  budgets: budget,
  providerIdentity: {
    providerId: 'org.modkitx.opensource/warzone2100-map-semantic',
    providerVersion: '0.1.0',
    artifactDigest: `sha256:${'0'.repeat(64)}`,
  },
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('game.map writer has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('game.map writer has no foreign service dependency')
    },
  },
}

function unchangedChange(bytes: Uint8Array): ChangeSet {
  const revision = revisionId(`content-hash.sha256:${entryDigest}`)
  const source = { id: 'installed-warzone-map', uri: `warzone-wz:installed/mp.wz!/${entryPath}` }
  return {
    targets: [
      {
        targetId: 'content',
        subjectUri: source.uri,
        ownerSource: source,
        semanticPath: [],
        expectedRevision: {
          bindings: { content: revision },
          compositionFingerprint: 'installed-warzone-2c-highground-game-map',
        },
      },
    ],
    edits: [
      {
        operation: 'replace',
        targetId: 'content',
        source,
        payload: { kind: 'inline', bytes },
      },
    ],
    semanticIntent: {
      kind: WARZONE_GAME_MAP_WRITE_INTENT.kind,
      sourceComplete: true,
      sourceContentDigest: `sha256:${entryDigest}`,
      unknownDataPolicy: WARZONE_GAME_MAP_WRITE_INTENT.unknownDataPolicy,
      updates: [],
    },
    provenance: { actor: 'agent', note: 'installed 2c-highground unchanged round-trip' },
  }
}

describe.skipIf(!configured)('installed Warzone 2100 preserving game.map writer', () => {
  it('round-trips 2c-highground/game.map byte-identically through validate, write and reopen', async () => {
    if (!existsSync(archivePath)) {
      throw new Error('MODKITX_WARZONE_ROOT must identify a Warzone install with data/mp.wz')
    }
    const archive = await readFile(archivePath)
    const entries = applyWarzoneLastWins(parseZipArchive(archive, 4_096)).effective
    const entry = entries.find(item => item.kind === 'file' && item.name === entryPath)
    if (entry === undefined) throw new Error(`${entryPath} is missing from installed mp.wz`)
    const source = await extractZipArchiveEntry(archive, entry)
    expect(createHash('sha256').update(source).digest('hex')).toBe(entryDigest)
    const lease = createMapProvider(
      {
        contract: 'common.edit/writer',
        major: 1,
        offerId: 'warzone2100-game-map-source',
      } as never,
      context,
    )
    const writer = lease.value as Writer
    const change = unchangedChange(source)
    expect(await writer.validate(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await writer.plan(change)
    const edit = plan.edits[0]
    if (edit?.operation !== 'replace' || edit.payload.kind !== 'inline') {
      throw new Error('installed game.map did not produce an inline replacement artifact')
    }
    expect(edit.payload.bytes).not.toBe(source)
    expect(Buffer.compare(edit.payload.bytes, source)).toBe(0)
    const reopened = parseWarzoneGameMap(edit.payload.bytes, budget)
    expect(reopened.tileCount).toBe(reopened.width * reopened.height)
    expect(reopened.version).toBe(10)
    console.info(
      `[warzone-game-map-writer] ${entryPath}: ${source.byteLength} bytes, ${reopened.width}x${reopened.height}, ${reopened.tileCount} tiles, ${reopened.gatewayCount} gateways, trailing=${reopened.trailingBytes}`,
    )
    await lease.release()
  }, 120_000)
})
