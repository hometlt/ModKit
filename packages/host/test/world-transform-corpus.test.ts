import { expect, it } from 'vitest'
import { mapQualificationTupleBytes, type ResolvedMapWorkspaceSnapshot } from '@modkit/sdk/maps'
import {
  createCandidateWorldSceneLease,
  worldTransformCorpusRefusal,
} from '../src/maps/world-source.js'

const sha256 = async (bytes: Uint8Array) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')}` as const

const MAP_DIGEST = `sha256:${'d'.repeat(64)}` as const

/** A 2 x 2 map whose transform's proof was qualified on this very map (its `fixture.map`). */
async function corpus(): Promise<ResolvedMapWorkspaceSnapshot> {
  const samples = Array.from({ length: 4 }, (_, index) => ({
    x: index % 2,
    y: Math.floor(index / 2),
    heightBase: index,
    heightAdjustment: 0,
    mask: 0,
  }))
  // native (x, y, height) in sample order; canonical (x, height, -y) row by row from the last row
  const native = samples.map(sample => [sample.x, sample.y, sample.heightBase] as const)
  const canonical = [2, 3, 0, 1].map(index => {
    const [x, y, z] = native[index]!
    return [x, z, -y === 0 ? 0 : -y] as const
  })
  return {
    schemaVersion: 1,
    workspaceId: 'workspace',
    gameId: 'example/game',
    mapId: 'fixture.map',
    analyzerId: 'fixture',
    snapshotId: 'snapshot-1',
    semantic: {
      schemaVersion: 1,
      workspaceId: 'workspace',
      gameId: 'example/game',
      mapId: 'fixture.map',
      analyzerId: 'fixture',
      documentPaths: [],
      terrain: {
        version: 1,
        width: 2,
        height: 2,
        cellCount: 4,
        minimumHeightBase: 0,
        maximumHeightBase: 3,
        minimumHeightAdjustment: 0,
        maximumHeightAdjustment: 0,
        trailingBytes: 0,
        samples,
      },
      objects: [],
      regions: [],
      diagnostics: [],
    },
    terrainTransform: {
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      descriptorVersion: 1,
      heightMap: { dim: [2, 2], offset: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      bounds: {
        coordinateSpaceId: 'map-native',
        minimum: { x: 0, y: 0, z: 0 },
        maximum: { x: 1, y: 1, z: 3 },
      },
      source: { terrainDocumentPath: 'fixture.map', format: 'fixture', heightEncoding: 'f64' },
      mapping: {
        horizontal: 'offset-plus-grid-index-times-scale',
        vertical: 'direct-base-times-scale-plus-offset',
      },
    },
    uvwTransform: {
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      sourceCoordinateSpaceId: 'map-native',
      targetCoordinateSpaceId: 'uvw-canonical',
      basis: {
        handedness: 'right',
        upAxis: 'y',
        forwardAxis: '+z',
        unit: 'source-unit',
        sourceUnit: 'fixture-unit',
      },
      axes: {
        x: { sourceAxis: 'x', scale: 1, offset: 0 },
        y: { sourceAxis: 'z', scale: 1, offset: 0 },
        z: { sourceAxis: 'y', scale: -1, offset: 0 },
      },
      heightfield: {
        columns: 2,
        rows: 2,
        cellSize: 1,
        origin: [0, 0, -1],
        sourceRowOrder: 'reverse',
      },
      bounds: {
        coordinateSpaceId: 'uvw-canonical',
        minimum: { x: 0, y: 0, z: -1 },
        maximum: { x: 1, y: 3, z: 0 },
      },
      proof: {
        kind: 'adapter-qualification',
        method: 'third-party-reference-differential',
        oracle: 'fixture',
        corpus: 'fixture.map',
        sourceDigests: { 'fixture.map': MAP_DIGEST },
        tupleCount: 4,
        comparison: 'ieee-754-binary64-exact',
        nativeTupleDigest: await sha256(mapQualificationTupleBytes(native)),
        canonicalTupleDigest: await sha256(mapQualificationTupleBytes(canonical)),
      },
    },
    worldCandidate: {
      contract: 'example/world',
      major: 1,
      maturity: 'publisher-candidate',
      coordinateSpaces: [],
      crossSpaceTransforms: [],
      unknownFacets: [],
    },
    unresolvedRequirementIds: [],
    diagnostics: [],
    diagnosticsTruncated: false,
    complete: true,
  } as unknown as ResolvedMapWorkspaceSnapshot
}

it('recomputes a proof on its own corpus and refuses a forged digest with the reason', async () => {
  const snapshot = await corpus()
  const read = new Map([['fixture.map', MAP_DIGEST]])
  expect(await worldTransformCorpusRefusal(snapshot, read)).toBeUndefined()
  const forged = {
    ...snapshot,
    uvwTransform: {
      ...snapshot.uvwTransform!,
      proof: { ...snapshot.uvwTransform!.proof, nativeTupleDigest: `sha256:${'e'.repeat(64)}` },
    },
  } as ResolvedMapWorkspaceSnapshot
  const refusal = await worldTransformCorpusRefusal(forged, read)
  expect(refusal).toBe('its native tuple digest is not that of its corpus terrain')
  // on another map the proof qualifies the adapter: nothing to recompute
  expect(
    await worldTransformCorpusRefusal(
      forged,
      new Map([['fixture.map', `sha256:${'f'.repeat(64)}`]]),
    ),
  ).toBeUndefined()
  expect(await worldTransformCorpusRefusal(forged, new Map())).toBeUndefined()
  // the world reports it as the transform's refusal
  const lease = createCandidateWorldSceneLease(
    forged,
    [],
    64,
    undefined,
    undefined,
    undefined,
    refusal,
  )
  try {
    const info = (await lease.value.info()) as {
      uvwTransform?: unknown
      uvwTransformRefusal?: string
    }
    expect(info.uvwTransform).toBeUndefined()
    expect(info.uvwTransformRefusal).toBe(refusal)
  } finally {
    await lease.release()
  }
})

it('refuses a proof method sdk does not name', async () => {
  const snapshot = await corpus()
  const lease = createCandidateWorldSceneLease(
    {
      ...snapshot,
      uvwTransform: {
        ...snapshot.uvwTransform!,
        proof: { ...snapshot.uvwTransform!.proof, method: 'eyeballed' as never },
      },
    },
    [],
    64,
  )
  try {
    expect(
      ((await lease.value.info()) as { uvwTransformRefusal?: string }).uvwTransformRefusal,
    ).toBe('its proof method eyeballed is none sdk names')
  } finally {
    await lease.release()
  }
})
