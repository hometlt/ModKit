import { describe, expect, it } from 'vitest'
import { mapQualificationTupleBytes, type ResolvedMapWorkspaceSnapshot } from '@modkit/sdk/maps'
import { writeFile } from 'node:fs/promises'
import { materializeWorldToUvw, parseUvwProfile, createUvwWorldSceneSource } from '@modkit/uv/world'
import { createCandidateWorldSceneLease } from '@modkit/host'
import { createCandidateWorldSceneLease as createSourceWorldSceneLease } from '../src/maps/world-source.js'

const snapshot: ResolvedMapWorkspaceSnapshot = {
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
    modelMetersPerSourceUnit: 0.01,
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
      samples: Array.from({ length: 4 }, (_, index) => ({
        x: index % 2,
        y: Math.floor(index / 2),
        heightBase: index,
        heightAdjustment: 0,
        mask: 0,
      })),
    },
    objects: [
      {
        kind: 'unit',
        objectId: 7,
        typeId: 'Marine',
        position: { x: 0.5, y: 0.5, z: 0 },
        catalog: {
          ref: { namespace: 'Unit', entityId: 'Marine' },
          entity: {
            namespace: 'Unit',
            typeId: 'CUnit',
            entityId: 'Marine',
            inheritanceChain: [],
            fields: {},
            sources: [],
            complete: true,
          },
        },
        modelResource: {
          id: 'model:marine',
          logicalId: 'base.assets/Assets/Marine.m3',
          role: 'sidecar',
          scopes: ['current-mount', 'workspace-dependency-layer'],
        },
      },
      {
        kind: 'unit',
        objectId: 8,
        typeId: 'Compound',
        position: { x: 1, y: 1, z: 0 },
        catalog: {
          ref: { namespace: 'Unit', entityId: 'Compound' },
          entity: {
            namespace: 'Unit',
            typeId: 'CUnit',
            entityId: 'Compound',
            inheritanceChain: [],
            fields: {},
            sources: [],
            complete: true,
          },
        },
        modelResources: [
          {
            id: 'model:body',
            logicalId: 'Parts/Body.pie',
            role: 'sidecar',
            scopes: ['current-mount'],
          },
          {
            id: 'model:tool',
            logicalId: 'Parts/Tool.pie',
            role: 'sidecar',
            scopes: ['current-mount'],
          },
        ],
        modelComponents: [
          { id: 'body', resourceId: 'model:body' },
          {
            id: 'tool',
            resourceId: 'model:tool',
            parentId: 'body',
            parentSocketId: 'connector-1',
          },
        ],
      },
    ],
    regions: [],
    catalogQueries: [],
    resolvedCatalogObjects: 2,
    diagnostics: [],
    complete: true,
  },
  terrainMaterials: {
    version: 1,
    width: 2,
    height: 2,
    cellCount: 4,
    textureNames: ['Grass'],
    exact: true,
    samples: Array.from({ length: 4 }, (_, index) => ({
      x: index % 2,
      y: Math.floor(index / 2),
      textureIndex: 0,
      textureName: 'Grass',
    })),
  },
  water: {
    version: 1,
    zones: [
      {
        zoneId: 3,
        templateId: 'Water',
        minimum: { x: 0, y: 0 },
        maximum: { x: 1, y: 1 },
        elevation: 9.25,
      },
    ],
  },
  cliffs: {
    version: 1,
    width: 2,
    height: 2,
    cellCount: 4,
    exact: true,
    samples: Array.from({ length: 4 }, (_, index) => ({
      x: index % 2,
      y: Math.floor(index / 2),
      level: index % 2,
      authored: index % 2 === 1,
    })),
  },
  lighting: {
    coordinateSpaceId: 'uvw-canonical',
    ambientColor: [0.6, 0.48, 0.35],
    ambientIntensity: 1,
    directional: [
      {
        id: 'key',
        direction: [0.36, -0.71, 0.59],
        color: [1, 1, 1],
        intensity: 1,
      },
    ],
  },
  worldCandidate: {
    contract: 'example/world',
    major: 1,
    maturity: 'publisher-candidate',
    coordinateSpaces: [],
    crossSpaceTransforms: [],
    unknownFacets: [],
    edit: { operationId: 'example/edit-world', moveObjectKind: 'object.update' },
  },
  unresolvedRequirementIds: [],
  diagnostics: [],
  diagnosticsTruncated: false,
  complete: true,
}

describe('common world source native visual facets', () => {
  it('keeps shoreline object heights on drawn triangles and preserves authored height policies', async () => {
    const objects = (['terrain-relative', 'terrain-surface', 'absolute', undefined] as const).map((heightReference, objectId) => ({
      kind: 'doodad' as const, objectId, position: { x: 0.51, y: 0.58, z: 3 },
      ...(heightReference === undefined ? {} : { heightReference }),
    }))
    objects.push({ kind: 'doodad', objectId: 4, position: { x: 1, y: 1, z: 3 }, heightReference: 'terrain-relative' })
    objects.push({ kind: 'doodad', objectId: 5, position: { x: 2, y: 1, z: 3 }, heightReference: 'terrain-relative' })
    const { terrainMaterials: _materials, ...snapshotWithoutMaterials } = snapshot
    const fixture: ResolvedMapWorkspaceSnapshot = {
      ...snapshotWithoutMaterials,
      semantic: { ...snapshot.semantic, objects, terrain: {
        ...snapshot.semantic.terrain!, minimumHeightBase: 130, maximumHeightBase: 270,
        samples: [270, 130, 270, 270].map((heightBase, index) => ({ x: index % 2, y: Math.floor(index / 2), heightBase, heightAdjustment: 0, mask: 0 })),
      } },
      terrainTransform: {
        schemaVersion: 1, snapshotId: snapshot.snapshotId, descriptorVersion: 1,
        heightMap: { dim: [2, 2], offset: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        bounds: { coordinateSpaceId: 'map-native', minimum: { x: 0, y: 0, z: 130 }, maximum: { x: 1, y: 1, z: 270 } },
        source: { terrainDocumentPath: 'terrain', format: 'fixture', heightEncoding: 'f64' },
        mapping: { horizontal: 'offset-plus-grid-index-times-scale', vertical: 'direct-base-times-scale-plus-offset' },
      },
    }
    const lease = createSourceWorldSceneLease(fixture, [], 64)
    try {
      const info = await lease.value.info()
      const facet = info.facets.find(f => f.facet === 'objects')!
      const page = await lease.value.page({ facet: 'objects', layerId: facet.layerId, limit: 64 })
      const placed = page.items.filter(i => i.facet === 'objects')
      expect(placed.map(i => i.mapNativePresentationPosition?.z ?? i.position.z)).toEqual([273, 270, 3, 3, 273, 3])
      expect(placed.map(i => i.position)).toEqual(objects.map(i => i.position))
    } finally { await lease.release() }
  })
  it('draws derived cliff pieces from the first resolving candidate with its yaw baked in', async () => {
    const requirement = (logicalId: string) => ({
      id: `cliff:${logicalId}`,
      logicalId,
      role: 'sidecar' as const,
      scopes: ['current-mount' as const],
    })
    const acquired: string[] = []
    const modelResources = {
      async acquire(request: { requirement: { logicalId: string } }) {
        acquired.push(request.requirement.logicalId)
        if (request.requirement.logicalId === 'Cliffs/Set_ABBA_00.m3')
          return { value: { result: { state: 'unresolved' as const, diagnostics: [] } }, async release() {} }
        const skin = request.requirement.logicalId === 'Cliffs/Set_Material.m3'
        return {
          value: {
            result: { state: 'converted' as const, bytes: new Uint8Array([1]), sourceKey: 'cliff', diagnostics: [] },
            async materials() {
              return {
                items: [
                  skin
                    ? { id: 'skin-material', name: 'Set skin', layers: [{ slot: 'diffuse', resourceId: 'Textures/Set.dds' }] }
                    : { id: 'material-0', name: 'Mesh', layers: [{ slot: 'diffuse', resourceId: 'Textures/Family.dds' }] },
                ],
              }
            },
            async readRaster() {
              return { state: 'unresolved' as const, diagnostics: [] }
            },
            async nodes() {
              return {
                items: [
                  { id: 'root', childIds: [], meshIds: ['mesh'], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] },
                ],
              }
            },
            async meshes() {
              return { items: [{ id: 'mesh', primitiveIds: ['triangle'] }] }
            },
            async primitive() {
              return { id: 'triangle', topology: 'triangles' as const, positions: new Float32Array(9) }
            },
          },
          async release() {},
        }
      },
    }
    const lease = createCandidateWorldSceneLease(
      {
        ...snapshot,
        cliffs: {
          ...snapshot.cliffs!,
          pieceModels: [
            {
              id: 'Set:ABBA:0',
              materialModel: requirement('Cliffs/Set_Material.m3'),
              candidates: [
                { requirement: requirement('Cliffs/Set_ABBA_00.m3'), yaw: 0 },
                { requirement: requirement('Cliffs/Set_BBAA_00.m3'), yaw: Math.PI / 2 },
              ],
            },
          ],
          pieces: [{ id: '5', position: { x: 1, y: 1, z: 6 }, modelId: 'Set:ABBA:0' }],
        },
      },
      [],
      64,
      modelResources as never,
    )
    try {
      const info = await lease.value.info()
      const objects = await lease.value.page({
        facet: 'objects',
        layerId: info.facets.find(item => item.facet === 'objects')!.layerId,
        limit: 64,
      })
      const piece = objects.items.find(item => item.facet === 'objects' && item.derivedFrom === 'cliffs')
      expect(piece).toMatchObject({ kind: 'doodad', resourceId: 'cliff-model:Set%3AABBA%3A0' })
      const model = await lease.value.model?.(piece!.facet === 'objects' ? piece!.resourceId! : '', {
        maxBytes: 1024,
        maxMeshes: 8,
        maxPrimitives: 8,
        maxPrimitiveBytes: 1024,
      })
      expect(acquired).toEqual([
        'Cliffs/Set_ABBA_00.m3',
        'Cliffs/Set_BBAA_00.m3',
        'Cliffs/Set_Material.m3',
      ])
      expect(model).toMatchObject({ state: 'converted' })
      // The cliff set's skin replaces the mesh family's material under the primitive's material id.
      expect(model?.state === 'converted' ? model.materials : undefined).toMatchObject([
        { id: 'material-0', name: 'Set skin', layers: [{ resourceId: 'Textures/Set.dds' }] },
      ])
      const transform = model?.state === 'converted' ? model.nodes?.[0]?.transform : undefined
      // +Y quarter turn: X axis -> -Z, translation (2,0,0) -> (0,0,-2).
      expect(transform?.slice(0, 3).map(value => Math.round(value) + 0)).toEqual([0, 0, -1])
      expect(transform?.slice(12, 15).map(value => Math.round(value) + 0)).toEqual([0, 0, -2])
    } finally {
      await lease.release()
    }
  })

  it("loads a placement's texture variant first and the texture as named when it is absent", async () => {
    const requested: { logicalId: string; alternatives?: readonly string[] }[] = []
    const modelResources = {
      async acquire() {
        return {
          value: {
            result: { state: 'converted' as const, bytes: new Uint8Array([1]), sourceKey: 'decal', diagnostics: [] },
            async materials() {
              return {
                items: [
                  {
                    id: 'material-0',
                    name: 'Decal',
                    layers: [
                      { slot: 'diffuse', resourceId: 'Assets/Textures/Decal00_Diffuse.dds' },
                      { slot: 'normal', resourceId: 'Assets/Textures/Decal00_Normal.dds' },
                    ],
                  },
                ],
              }
            },
            async readRaster(request: { requirement: { logicalId: string; alternatives?: readonly string[] } }) {
              const { logicalId, alternatives } = request.requirement
              requested.push({ logicalId, ...(alternatives === undefined ? {} : { alternatives }) })
              return { state: 'unresolved' as const, diagnostics: [] }
            },
            async nodes() {
              return { items: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }
            },
            async meshes() {
              return { items: [{ id: 'mesh', primitiveIds: ['triangle'] }] }
            },
            async primitive() {
              return { id: 'triangle', topology: 'triangles' as const, positions: new Float32Array(9) }
            },
          },
          async release() {},
        }
      },
    }
    const variant = { suffix: '_monlyth', names: [{ prefix: 'decal00_', contains: '_DIFFUSE' }] }
    const lease = createSourceWorldSceneLease(
      {
        ...snapshot,
        semantic: {
          ...snapshot.semantic,
          objects: [
            {
              kind: 'doodad',
              objectId: 30,
              typeId: 'Decal',
              position: { x: 0.5, y: 0.5, z: 0 },
              catalog: { ref: { namespace: 'Actor', entityId: 'Decal' } },
              modelResource: {
                id: 'model:decal:textures_monlyth',
                logicalId: 'base.assets/Assets/Doodads/Decal/Decal_00.m3',
                role: 'sidecar',
                scopes: ['current-mount'],
              },
              modelTextureVariant: variant,
            },
          ],
        },
      },
      [],
      64,
      modelResources as never,
    )
    try {
      const info = await lease.value.info()
      const resources = await lease.value.page({
        facet: 'resources',
        layerId: info.facets.find(item => item.facet === 'resources')!.layerId,
        limit: 64,
      })
      const resource = resources.items.find(item => item.facet === 'resources' && item.entityId === 'Decal')
      expect(resource).toMatchObject({ modelTextureVariant: variant })
      await lease.value.model?.(resource!.id, { maxBytes: 1024, maxMeshes: 8, maxPrimitives: 8, maxPrimitiveBytes: 1024 })
      // Names compare without case; only the texture the variant names asks for the variant.
      expect(requested).toEqual([
        {
          logicalId: 'base.assets/Assets/Textures/Decal00_Diffuse_monlyth.dds',
          alternatives: ['base.assets/Assets/Textures/Decal00_Diffuse.dds'],
        },
        { logicalId: 'base.assets/Assets/Textures/Decal00_Normal.dds' },
      ])
    } finally {
      await lease.release()
    }
  })

  it('reads every page of a large model and keeps its graph whole when primitives run out', async () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    // a root with 2 500 children, one mesh each: far more than one page of 1 024 nodes
    const parts = Array.from({ length: 2500 }, (_, index) => `part-${index}`)
    const nodes = [
      { id: 'root', childIds: parts, meshIds: [], transform: identity },
      ...parts.map(id => ({ id, childIds: [], meshIds: [`mesh-${id}`], transform: identity })),
    ]
    const meshes = parts.map(id => ({ id: `mesh-${id}`, primitiveIds: [`prim-${id}`] }))
    const page = <Item>(items: readonly Item[], request: { limit: number; cursor?: string }) => {
      const start = Number(request.cursor ?? 0)
      const end = start + request.limit
      return { items: items.slice(start, end), ...(end < items.length ? { nextCursor: String(end) } : {}) }
    }
    const modelResources = {
      async acquire() {
        return {
          value: {
            result: { state: 'converted' as const, bytes: new Uint8Array([1]), sourceKey: 'place', diagnostics: [] },
            async nodes(request: { limit: number; cursor?: string }) {
              return page(nodes, request)
            },
            async meshes(request: { limit: number; cursor?: string }) {
              return page(meshes, request)
            },
            async primitive(id: string) {
              return { id, topology: 'triangles' as const, positions: new Float32Array(9) }
            },
            async readRaster() {
              return { state: 'unresolved' as const, diagnostics: [] }
            },
          },
          async release() {},
        }
      },
    }
    const requirement = {
      id: 'cliff:Place.rbxm',
      logicalId: 'Place.rbxm',
      role: 'sidecar' as const,
      scopes: ['current-mount' as const],
    }
    const lease = createSourceWorldSceneLease(
      {
        ...snapshot,
        cliffs: {
          ...snapshot.cliffs!,
          pieceModels: [{ id: 'Place', candidates: [{ requirement, yaw: 0 }] }],
          pieces: [{ id: '1', position: { x: 1, y: 1, z: 6 }, modelId: 'Place' }],
        },
      },
      [],
      1024,
      modelResources as never,
    )
    try {
      const info = await lease.value.info()
      const objects = await lease.value.page({
        facet: 'objects',
        layerId: info.facets.find(item => item.facet === 'objects')!.layerId,
        limit: 64,
      })
      const piece = objects.items.find(item => item.facet === 'objects' && item.derivedFrom === 'cliffs')
      const request = {
        maxMeshes: 256,
        maxNodes: 1024,
        maxPrimitives: 512,
        maxPrimitiveBytes: 1024,
      }
      // enough bytes for every primitive (36 bytes each): the whole place arrives
      const whole = await lease.value.model?.(
        piece!.facet === 'objects' ? piece!.resourceId! : '',
        { ...request, maxBytes: 1 << 20 },
      )
      if (whole?.state !== 'converted') throw new Error('model did not convert')
      expect([whole.nodes?.length, whole.meshes.length, whole.primitives.length, whole.complete]).toEqual([
        2501, 2500, 2500, true,
      ])
      // a byte budget for 1 000 primitives: the rest is left out, and no node names what is missing
      const cut = await lease.value.model?.(
        piece!.facet === 'objects' ? piece!.resourceId! : '',
        { ...request, maxBytes: 36_000 },
      )
      if (cut?.state !== 'converted') throw new Error('model did not convert')
      expect([cut.meshes.length, cut.complete]).toEqual([1000, false])
      const present = new Set(cut.nodes!.map(node => node.id))
      const drawn = new Set(cut.meshes.map(mesh => mesh.id))
      expect(cut.nodes!.every(node => node.childIds.every(id => present.has(id)))).toBe(true)
      expect(cut.nodes!.every(node => (node.meshIds ?? []).every(id => drawn.has(id)))).toBe(true)
      expect(cut.diagnostics.map(item => item.code)).toContain('x3.host/world-model-graph-truncated')
    } finally {
      await lease.release()
    }
  })

  it('splits a catalog resource per model when instances resolve different variations', async () => {
    const rock = (objectId: number, variation: number) => ({
      kind: 'doodad' as const,
      objectId,
      typeId: 'Rock',
      position: { x: 0.5, y: 0.5, z: 0 },
      catalog: { ref: { namespace: 'Actor', entityId: 'Rock' } },
      modelResource: {
        id: `model:rock:variation-0${String(variation)}`,
        logicalId: `Assets/Rock_0${String(variation)}.m3`,
        role: 'sidecar' as const,
        scopes: ['current-mount' as const],
      },
    })
    const lease = createCandidateWorldSceneLease(
      {
        ...snapshot,
        semantic: {
          ...snapshot.semantic,
          objects: [...snapshot.semantic.objects, rock(20, 0), rock(21, 1), rock(22, 1)],
        },
      },
      [],
      64,
    )
    try {
      const info = await lease.value.info()
      const page = async (facet: 'objects' | 'resources') =>
        (
          await lease.value.page({
            facet,
            layerId: info.facets.find(item => item.facet === facet)!.layerId,
            limit: 64,
          })
        ).items
      const objects = new Map(
        (await page('objects')).flatMap(item =>
          item.facet === 'objects' ? [[item.objectId, item.resourceId]] : [],
        ),
      )
      expect(objects.get(7)).toBe('resource:Unit/Marine')
      expect(objects.get(20)).not.toBe(objects.get(21))
      expect(objects.get(21)).toBe(objects.get(22))
      const resources = new Map(
        (await page('resources')).flatMap(item =>
          item.facet === 'resources' ? [[item.id, item.modelResource?.logicalId]] : [],
        ),
      )
      expect(resources.get(objects.get(20)!)).toBe('Assets/Rock_00.m3')
      expect(resources.get(objects.get(21)!)).toBe('Assets/Rock_01.m3')
    } finally {
      await lease.release()
    }
  })

  it('admits a forward row order and names the check a refused UVW transform failed', async () => {
    const terrainTransform = {
      schemaVersion: 1 as const,
      snapshotId: snapshot.snapshotId,
      descriptorVersion: 1,
      heightMap: {
        dim: [2, 2] as const,
        offset: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      bounds: {
        coordinateSpaceId: 'map-native' as const,
        minimum: { x: 0, y: 0, z: 0 },
        maximum: { x: 1, y: 1, z: 3 },
      },
      source: { terrainDocumentPath: 'terrain', format: 'fixture', heightEncoding: 'f64' },
      mapping: {
        horizontal: 'offset-plus-grid-index-times-scale' as const,
        vertical: 'direct-base-times-scale-plus-offset' as const,
      },
    }
    // (x, y, z) -> (x, z, y): rows run along +z in file order
    const uvwTransform = {
      schemaVersion: 1 as const,
      snapshotId: snapshot.snapshotId,
      sourceCoordinateSpaceId: 'map-native',
      targetCoordinateSpaceId: 'uvw-canonical' as const,
      basis: {
        handedness: 'right' as const,
        upAxis: 'y' as const,
        forwardAxis: '+z' as const,
        unit: 'source-unit' as const,
        sourceUnit: 'fixture-unit',
      },
      axes: {
        x: { sourceAxis: 'x' as const, scale: 1, offset: 0 },
        y: { sourceAxis: 'z' as const, scale: 1, offset: 0 },
        z: { sourceAxis: 'y' as const, scale: 1, offset: 0 },
      },
      heightfield: {
        columns: 2,
        rows: 2,
        cellSize: 1,
        origin: [0, 0, 0] as const,
        sourceRowOrder: 'forward' as const,
      },
      bounds: {
        coordinateSpaceId: 'uvw-canonical' as const,
        minimum: { x: 0, y: 0, z: 0 },
        maximum: { x: 1, y: 3, z: 1 },
      },
      proof: {
        kind: 'adapter-qualification' as const,
        method: 'third-party-reference-differential' as const,
        oracle: 'fixture',
        corpus: 'fixture',
        sourceDigests: { fixture: `sha256:${'a'.repeat(64)}` as const },
        tupleCount: 4,
        comparison: 'ieee-754-binary64-exact' as const,
        nativeTupleDigest: `sha256:${'b'.repeat(64)}` as const,
        canonicalTupleDigest: `sha256:${'c'.repeat(64)}` as const,
      },
    }
    const infoOf = async (transform: object) => {
      const lease = createSourceWorldSceneLease(
        { ...snapshot, terrainTransform, uvwTransform: transform as typeof uvwTransform },
        [],
        64,
      )
      try {
        return (await lease.value.info()) as Awaited<ReturnType<typeof lease.value.info>> & {
          uvwTransformRefusal?: string
        }
      } finally {
        await lease.release()
      }
    }
    const admitted = await infoOf(uvwTransform)
    expect(admitted.uvwTransform?.heightfield.sourceRowOrder).toBe('forward')
    expect(admitted.uvwTransformRefusal).toBeUndefined()

    const refusalOf = async (transform: object) => (await infoOf(transform)).uvwTransformRefusal
    expect(
      await refusalOf({ ...uvwTransform, heightfield: { ...uvwTransform.heightfield, columns: 3 } }),
    ).toBe('its heightfield 3x2 is not the terrain grid 2x2')
    expect(
      await refusalOf({ ...uvwTransform, proof: { ...uvwTransform.proof, comparison: 'close' } }),
    ).toBe('its proof comparison is not ieee-754-binary64-exact')
    expect(
      await refusalOf({
        ...uvwTransform,
        bounds: { ...uvwTransform.bounds, maximum: { x: 1, y: 2, z: 1 } },
      }),
    ).toBe('its bounds are not the canonical image of the terrain bounds')
  })

  it('places the objects of a world without terrain by its measured transform (MW1)', async () => {
    const { terrain: _terrain, ...semantic } = snapshot.semantic
    const { terrainMaterials: _materials, cliffs: _cliffs, ...rest } = snapshot
    // chunks: map-native y runs north, canonical +z south
    const uvwTransform = {
      schemaVersion: 1 as const,
      snapshotId: snapshot.snapshotId,
      sourceCoordinateSpaceId: 'map-native',
      targetCoordinateSpaceId: 'uvw-canonical' as const,
      basis: {
        handedness: 'right' as const,
        upAxis: 'y' as const,
        forwardAxis: '+z' as const,
        unit: 'meter' as const,
      },
      axes: {
        x: { sourceAxis: 'x' as const, scale: 1, offset: 0 },
        y: { sourceAxis: 'z' as const, scale: 1, offset: 0 },
        z: { sourceAxis: 'y' as const, scale: -1, offset: 0 },
      },
      heightfield: {
        columns: 16,
        rows: 16,
        cellSize: 1,
        origin: [0, 0, -16] as const,
        sourceRowOrder: 'reverse' as const,
      },
      bounds: {
        coordinateSpaceId: 'uvw-canonical' as const,
        minimum: { x: 0, y: 0, z: -16 },
        maximum: { x: 16, y: 64, z: 0 },
      },
      proof: {
        kind: 'adapter-qualification' as const,
        method: 'official-reference-differential' as const,
        oracle: 'fixture',
        corpus: 'fixture',
        sourceDigests: { fixture: `sha256:${'a'.repeat(64)}` as const },
        tupleCount: 4,
        comparison: 'ieee-754-binary64-exact' as const,
        nativeTupleDigest: `sha256:${'b'.repeat(64)}` as const,
        canonicalTupleDigest: `sha256:${'c'.repeat(64)}` as const,
      },
    }
    const objectsOf = async (transform: typeof uvwTransform | undefined) => {
      const lease = createSourceWorldSceneLease(
        { ...rest, semantic, ...(transform === undefined ? {} : { uvwTransform: transform }) },
        [],
        64,
      )
      try {
        const info = await lease.value.info()
        const facet = info.facets.find(item => item.facet === 'objects')!
        const page = await lease.value.page({ facet: 'objects', layerId: facet.layerId, limit: 64 })
        return { info, facet, items: page.items }
      } finally {
        await lease.release()
      }
    }
    const placed = await objectsOf(uvwTransform)
    expect((placed.info as { uvwTransformRefusal?: string }).uvwTransformRefusal).toBeUndefined()
    expect(placed.info.uvwTransform?.axes.z.scale).toBe(-1)
    const marine = placed.items.find(item => item.facet === 'objects' && item.objectId === 7)
    expect(marine).toMatchObject({ uvwPosition: { x: 0.5, y: 0, z: -0.5 } })
    expect(placed.facet.reason).toBeUndefined()
    expect(
      (
        await objectsOf({
          ...uvwTransform,
          heightfield: { ...uvwTransform.heightfield, columns: 0 },
        })
      ).info,
    ).toMatchObject({ uvwTransformRefusal: 'its heightfield 0x16 is not a grid of positive size' })
    // without a transform the objects keep native positions, and the facet says so
    const unplaced = await objectsOf(undefined)
    expect(unplaced.items.some(item => 'uvwPosition' in item)).toBe(false)
    expect(unplaced.facet.reason).toContain('objects have no canonical UVW placement')
  })

  it('publishes the map player slots a viewer colours objects by (П10)', async () => {
    const players = [
      { id: 1, color: [1, 0, 0] as const, team: 1, race: 'Terr' },
      { id: 2, color: [0, 0, 1] as const, team: 2 },
    ]
    const lease = createSourceWorldSceneLease(
      { ...snapshot, semantic: { ...snapshot.semantic, players } },
      [],
      64,
    )
    try {
      expect((await lease.value.info()).players).toEqual(players)
    } finally {
      await lease.release()
    }
  })

  it("publishes the game's view of its world, and none out of range (П59)", async () => {
    const camera = { projection: 'orthographic', azimuthDegrees: 45, elevationDegrees: 30 } as const
    const info = async (value: unknown) => {
      const lease = createSourceWorldSceneLease(
        { ...snapshot, camera: value } as ResolvedMapWorkspaceSnapshot,
        [],
        64,
      )
      try {
        return await lease.value.info()
      } finally {
        await lease.release()
      }
    }
    expect((await info(camera)).camera).toEqual(camera)
    expect((await info({ ...camera, elevationDegrees: 120 })).camera).toBeUndefined()
    expect((await info({ projection: 'fisheye' })).camera).toBeUndefined()
  })

  it('reads rectangles, diamonds and polygons of regions as geometry', async () => {
    const region = (regionId: number, type: string, parameters: Record<string, string>) => ({
      regionId,
      name: `Region ${String(regionId)}`,
      shapes: [{ type, parameters }],
    })
    const lease = createSourceWorldSceneLease(
      {
        ...snapshot,
        semantic: {
          ...snapshot.semantic,
          regions: [
            region(1, 'rect', { min: '3,3', max: '1,1' }),
            region(2, 'Rectangle', { minimum: '0,4', maximum: '2,6' }),
            region(3, 'diamond', { min: '0,0', max: '2,4' }),
            region(4, 'polygon', { points: '0,0 1,0;1,1' }),
            region(5, 'circle', { center: '1,1', radius: '0.5' }),
            region(6, 'polygon', { points: '0,0 1,0' }),
          ],
        },
      },
      [],
      64,
    )
    try {
      const info = await lease.value.info()
      const layerId = info.facets.find(item => item.facet === 'regions')!.layerId
      const shapes = new Map(
        (await lease.value.page({ facet: 'regions', layerId, limit: 64 })).items.flatMap(item =>
          item.facet === 'regions' ? [[item.regionId, item.shapes[0]!]] : [],
        ),
      )
      expect(shapes.get(1)).toMatchObject({
        kind: 'rectangle',
        minimum: { x: 1, y: 1 },
        maximum: { x: 3, y: 3 },
      })
      expect(shapes.get(2)).toMatchObject({
        kind: 'rectangle',
        minimum: { x: 0, y: 4 },
        maximum: { x: 2, y: 6 },
      })
      expect(shapes.get(3)).toMatchObject({
        kind: 'polygon',
        points: [
          { x: 1, y: 0 },
          { x: 2, y: 2 },
          { x: 1, y: 4 },
          { x: 0, y: 2 },
        ],
      })
      expect(shapes.get(4)).toMatchObject({
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      })
      expect(shapes.get(5)).toMatchObject({ kind: 'circle', center: { x: 1, y: 1 }, radius: 0.5 })
      // two points are no polygon: the shape keeps its raw parameters only
      expect(shapes.get(6)).toEqual({ kind: 'polygon', rawParameters: { points: '0,0 1,0' } })
    } finally {
      await lease.release()
    }
  })

  it('keeps layer and item identities compact while cursors remain snapshot-bound', async () => {
    const longSnapshotId = `snapshot-${'dependency-revision/'.repeat(1_024)}`
    const longSnapshot = { ...snapshot, snapshotId: longSnapshotId }
    const longLease = createCandidateWorldSceneLease(longSnapshot, [], 32)
    const nextLease = createCandidateWorldSceneLease(
      { ...snapshot, snapshotId: 'snapshot-next' },
      [],
      32,
    )
    try {
      const info = await longLease.value.info()
      const terrainLayer = info.facets.find(item => item.facet === 'terrain')
      expect(terrainLayer).toBeDefined()
      if (terrainLayer === undefined) throw new Error('terrain layer is unavailable')
      expect(terrainLayer.layerId).toBe('main/terrain')

      const layers = await longLease.value.page({ facet: 'layers', limit: 32 })
      expect(layers.items.every(item => item.id.length < 64 && item.layerId.length < 64)).toBe(true)

      const first = await longLease.value.page({
        facet: 'terrain',
        layerId: terrainLayer.layerId,
        lod: 'exact',
        limit: 1,
      })
      expect(first.items[0]).toMatchObject({
        id: 'main/terrain:sample:0:0',
        layerId: 'main/terrain',
      })
      expect(first.nextCursor).toBeDefined()
      const cursor = first.nextCursor
      if (cursor === undefined) throw new Error('terrain page did not return a continuation cursor')

      const second = await longLease.value.page({
        facet: 'terrain',
        layerId: terrainLayer.layerId,
        lod: 'exact',
        limit: 1,
        cursor,
      })
      expect(second.items[0]).toMatchObject({ id: 'main/terrain:sample:1:0' })

      await expect(
        nextLease.value.page({
          facet: 'terrain',
          layerId: terrainLayer.layerId,
          lod: 'exact',
          limit: 1,
          cursor,
        }),
      ).rejects.toThrow('world cursor belongs to another or stale source snapshot')
    } finally {
      await longLease.release()
      await nextLease.release()
    }
  })

  it('materializes and pages terrain materials, water and cliffs without publisher branching', async () => {
    let acquiredLogicalId: string | undefined
    let acquiredMetersPerSourceUnit: number | undefined
    let acquiredTextureLogicalId: string | undefined
    let rasterReads = 0
    const modelResources = {
      async acquire(request: { requirement: { logicalId: string }; metersPerSourceUnit?: number }) {
        acquiredLogicalId = request.requirement.logicalId
        acquiredMetersPerSourceUnit = request.metersPerSourceUnit
        if (request.requirement.logicalId === 'Parts/Tool.pie') {
          return {
            value: {
              result: {
                state: 'converted' as const,
                bytes: new Uint8Array([9, 8, 7]),
                sourceKey: 'geometry-less-tool',
                diagnostics: [],
              },
              async meshes() { return { items: [] } },
              async materials() { return { items: [{ id: 'projector-material' }] } },
            },
            async release() {},
          }
        }
        return {
          value: {
            result: {
              state: 'converted' as const,
              bytes: new Uint8Array([1, 2, 3]),
              sourceKey: 'marine',
              diagnostics: [],
            },
            async nodes() {
              return {
                items: [
                  {
                    id: 'root',
                    childIds: [],
                    meshIds: ['mesh'],
                    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                  },
                ],
              }
            },
            async meshes() {
              return { items: [{ id: 'mesh', primitiveIds: ['triangle'] }] }
            },
            async primitive() {
              return {
                id: 'triangle',
                topology: 'triangles' as const,
                positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
              }
            },
            async skeletonBindings() {
              return {
                items: [
                  {
                    partId: 'triangle',
                    boneIndex: 0,
                    boneName: 'root',
                    provenance: 'direct',
                    nodeId: 'root',
                  },
                ],
              }
            },
            async animationClips() {
              return {
                items: [
                  {
                    id: 'idle',
                    name: 'Idle',
                    kind: 'animation',
                    provenance: 'direct',
                    frames: 2,
                    channels: [],
                  },
                ],
              }
            },
            async materials() {
              return {
                items: [
                  {
                    id: 'marine',
                    name: 'Marine',
                    layers: [{ slot: 'diffuse', resourceId: 'Assets/Marine.dds' }],
                  },
                ],
              }
            },
            async resourceReferences() {
              return { items: [] }
            },
            async sockets() {
              return {
                items: [{ id: 'weapon', nodeId: 'root', role: 'weapon', sourceName: 'Ref_Weapon' }],
              }
            },
            async acquire() {
              throw new Error('not used')
            },
            async readRaster(request: {
              requirement: { logicalId: string }
              selection?: { mipLevel?: number | 'fit' }
            }) {
              rasterReads += 1
              acquiredTextureLogicalId = request.requirement.logicalId
              const mipLevel = request.selection?.mipLevel
              if (mipLevel !== 'fit') {
                return {
                  state: 'unresolved',
                  diagnostics: [
                    {
                      severity: 'warning',
                      code: 'test/unexpected-preview-mip',
                      message: `unexpected preview mip ${String(mipLevel)}`,
                    },
                  ],
                }
              }
              return {
                state: 'decoded',
                info: {
                  width: 1,
                  height: 1,
                  depth: 1,
                  layers: 1,
                  faces: 1,
                  mipLevels: 2,
                  frames: 1,
                  channels: 4,
                  bitDepth: 8,
                  colorSpace: 'srgb',
                  alphaMode: 'straight',
                  orientation: 'top-left',
                  decodedAccess: true,
                },
                region: {
                  width: 1,
                  height: 1,
                  rowStride: 4,
                  pixelFormat: 'rgba8',
                  pixels: Uint8Array.of(12, 34, 56, 255),
                },
                subresource: { frame: 0, mipLevel: 1, layer: 0, face: 0, slice: 0 },
                diagnostics: [],
              }
            },
          },
          async release() {},
        }
      },
    }
    const lease = createCandidateWorldSceneLease(snapshot, [], 32, modelResources as never)
    try {
      const info = await lease.value.info()
      expect(info.edit).toEqual(snapshot.worldCandidate.edit)
      expect(info.facets.find(item => item.facet === 'water')).toMatchObject({
        state: 'available',
        itemCount: 1,
      })
      expect(info.facets.map(item => item.facet)).toEqual([
        'terrain',
        'terrain-materials',
        'water',
        'cliffs',
        'objects',
        'regions',
        'resources',
        'navigation',
        'gateways',
        'lighting',
      ])
      const layers = await lease.value.page({ facet: 'layers', limit: 32 })
      expect(layers.items).toHaveLength(10)
      const lightingLayer = info.facets.find(item => item.facet === 'lighting')!
      expect(lightingLayer).toMatchObject({ state: 'available', itemCount: 1 })
      const lighting = await lease.value.page({
        facet: 'lighting',
        layerId: lightingLayer.layerId,
        limit: 32,
      })
      expect(lighting.items).toEqual([
        expect.objectContaining({
          facet: 'lighting',
          coordinateSpaceId: 'uvw-canonical',
          ambientColor: [0.6, 0.48, 0.35],
          ambientIntensity: 1,
          directional: [expect.objectContaining({ id: 'key', intensity: 1 })],
        }),
      ])
      const materialLayer = info.facets.find(item => item.facet === 'terrain-materials')!
      const materials = await lease.value.page({
        facet: 'terrain-materials',
        layerId: materialLayer.layerId,
        lod: 'exact',
        limit: 32,
      })
      expect(materials.items).toHaveLength(4)
      const waterLayer = info.facets.find(item => item.facet === 'water')!
      const water = await lease.value.page({
        facet: 'water',
        layerId: waterLayer.layerId,
        lod: 'exact',
        limit: 32,
        bounds: { minimumX: 0.5, minimumY: 0.5, maximumX: 2, maximumY: 2 },
      })
      expect(water.items[0]).toMatchObject({
        facet: 'water',
        zoneId: 3,
        templateId: 'Water',
        elevation: 9.25,
      })
      const cliffLayer = info.facets.find(item => item.facet === 'cliffs')!
      const cliffs = await lease.value.page({
        facet: 'cliffs',
        layerId: cliffLayer.layerId,
        lod: 'exact',
        limit: 32,
      })
      expect(cliffs.items).toHaveLength(4)
      const resourceLayer = info.facets.find(item => item.facet === 'resources')!
      const resourcePage = await lease.value.page({
        facet: 'resources',
        layerId: resourceLayer.layerId,
        limit: 32,
      })
      expect(
        resourcePage.items.filter(
          item => item.facet === 'resources' && item.modelResource?.logicalId.startsWith('Parts/'),
        ),
      ).toHaveLength(2)
      const geometryLessResource = resourcePage.items.find(
        item => item.facet === 'resources' && item.modelResource?.logicalId === 'Parts/Tool.pie',
      )
      expect(
        await lease.value.model?.(geometryLessResource!.id, {
          maxBytes: 1024,
          maxMeshes: 8,
          maxPrimitives: 8,
          maxPrimitiveBytes: 1024,
        }),
      ).toMatchObject({
        state: 'converted',
        sourceKey: 'geometry-less-tool',
        uvmBytes: new Uint8Array([9, 8, 7]),
        meshes: [],
        primitives: [],
        materials: [{ id: 'projector-material' }],
        diagnostics: [],
        complete: true,
      })
      const objectLayer = info.facets.find(item => item.facet === 'objects')!
      const objectPage = await lease.value.page({
        facet: 'objects',
        layerId: objectLayer.layerId,
        limit: 32,
      })
      expect(
        objectPage.items.find(item => item.facet === 'objects' && item.objectId === 8),
      ).toMatchObject({
        resourceIds: ['model-resource:model%3Abody', 'model-resource:model%3Atool'],
        modelComponents: [
          { id: 'body', resourceId: 'model-resource:model%3Abody' },
          {
            id: 'tool',
            resourceId: 'model-resource:model%3Atool',
            parentId: 'body',
            parentSocketId: 'connector-1',
          },
        ],
      })
      const resource = resourcePage.items.find(
        item =>
          item.facet === 'resources' &&
          item.modelResource?.logicalId === 'base.assets/Assets/Marine.m3',
      )
      expect(resource).toMatchObject({
        modelResource: { logicalId: 'base.assets/Assets/Marine.m3' },
      })
      const converted = await lease.value.model?.(resource!.id, {
        maxBytes: 1024,
        maxMeshes: 8,
        maxPrimitives: 8,
        maxPrimitiveBytes: 1024,
      })
      expect(converted).toMatchObject({
        state: 'converted',
        nodes: [{ id: 'root' }],
        skeleton: [{ boneIndex: 0, nodeId: 'root' }],
        animations: [{ id: 'idle' }],
        materials: [{ id: 'marine' }],
        resources: [{ id: 'Assets/Marine.dds', role: 'texture' }],
        sockets: [{ id: 'weapon', nodeId: 'root', role: 'weapon', sourceName: 'Ref_Weapon' }],
        textures: [
          {
            id: 'Assets/Marine.dds',
            width: 1,
            height: 1,
            rgba: Uint8Array.of(12, 34, 56, 255),
          },
        ],
        primitives: [{ id: 'triangle' }],
        diagnostics: [
          {
            code: 'x3.host/world-model-texture-preview-mip-selected',
          },
        ],
        complete: true,
      })
      expect(acquiredLogicalId).toBe('base.assets/Assets/Marine.m3')
      expect(acquiredTextureLogicalId).toBe('base.assets/Assets/Marine.dds')
      expect(acquiredMetersPerSourceUnit).toBe(0.01)
      expect(
        await lease.value.model?.(resource!.id, {
          maxBytes: 1024,
          maxMeshes: 8,
          maxPrimitives: 8,
          maxPrimitiveBytes: 1024,
        }),
      ).toMatchObject({ state: 'converted', textures: [{ id: 'Assets/Marine.dds' }] })
      expect(rasterReads).toBe(1)
    } finally {
      await lease.release()
    }
  })

  it('reads every caustics frame of a water material by its scoped requirement', async () => {
    const frame = (index: number) => ({
      id: `caustics:${String(index)}`,
      logicalId: `base.assets/Water/Caustics_00${String(index)}.dds`,
      role: 'texture' as const,
      scopes: ['current-mount' as const],
    })
    const requested: string[] = []
    const selections: unknown[] = []
    const rasterResources = {
      async read(request: { requirement: { logicalId: string }; selection?: unknown }) {
        requested.push(request.requirement.logicalId)
        selections.push(request.selection)
        return {
          state: 'decoded',
          info: { orientation: 'top-left' },
          region: { width: 1, height: 1, rowStride: 4, pixels: Uint8Array.of(1, 2, 3, 255) },
          diagnostics: [],
        }
      },
    }
    const lease = createSourceWorldSceneLease(
      {
        ...snapshot,
        water: {
          ...snapshot.water!,
          materials: [
            {
              materialId: 'water',
              color: [0.1, 0.3, 0.5, 0.3],
              causticsResourceId: 'caustics:1',
              causticsResource: frame(1),
              causticsFrameResourceIds: ['caustics:1', 'caustics:2'],
              causticsFrameResources: [frame(1), frame(2)],
              causticsFalloff: 1.56,
            },
          ],
        },
      } as ResolvedMapWorkspaceSnapshot,
      [],
      32,
      undefined,
      undefined,
      rasterResources as never,
    )
    try {
      const second = await lease.value.texture?.('caustics:2', { maxBytes: 1024 })
      expect(second).toMatchObject({ state: 'decoded', texture: { id: 'caustics:2', width: 1 } })
      expect(requested).toEqual(['base.assets/Water/Caustics_002.dds'])
      // a texture larger than maxBytes comes at the largest level that fits (a BAR map's 4096²)
      expect(selections).toEqual([{ mipLevel: 'fit' }])
    } finally {
      await lease.release()
    }
  })
})

const sha256 = async (bytes: Uint8Array) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')}` as const

const MAP_DIGEST = `sha256:${'d'.repeat(64)}` as const

/** A 2 x 2 map whose transform's proof was qualified on this very map (its `fixture.map`). */
async function rotationCorpus(): Promise<ResolvedMapWorkspaceSnapshot> {
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



describe('independent authored and absolute presentation rotations (Host constructor witness)', () => {
  const cases = [
    { unit: 'degrees' as const, authored: 30, presented: 90 },
    { unit: 'radians' as const, authored: Math.PI / 6, presented: Math.PI / 2 },
    { unit: 'uint16-turn' as const, authored: 65536 / 12, presented: 16384 },
  ].flatMap(item => (['counter-clockwise', 'clockwise'] as const).map(sense => ({ ...item, sense })))

  it.each(cases)('keeps authored and presentation apart for $unit/$sense', async ({ unit, authored, presented, sense }) => {
    const base = await rotationCorpus()
    const lease = createCandidateWorldSceneLease({ ...base, semantic: { ...base.semantic, objects: [{
      kind: 'feature', objectId: 7, position: { x: 0.5, y: 0.5, z: 0 },
      rotation: authored, presentationRotation: presented, nativeRotationUnit: unit, nativeRotationSense: sense,
    }] } }, [], 64)
    try {
      const info = await lease.value.info()
      const facet = info.facets.find(item => item.facet === 'objects')!
      const page = await lease.value.page({ facet: 'objects', layerId: facet.layerId, limit: 64 })
      const object = page.items.find(item => item.facet === 'objects')
      if (object?.facet !== 'objects') throw new Error('missing placed object')
      const sign = sense === 'clockwise' ? -1 : 1
      expect(object.rotation).toBe(authored)
      expect(object.presentationRotation).toBe(presented)
      expect(object.uvwRotation?.[1]).toBeCloseTo(sign * Math.sin(Math.PI / 12), 14)
      expect(object.uvwRotation?.[3]).toBeCloseTo(Math.cos(Math.PI / 12), 14)
      expect(object.uvwPresentationRotation?.[1]).toBeCloseTo(sign * Math.sin(Math.PI / 4), 14)
      expect(object.uvwPresentationRotation?.[3]).toBeCloseTo(Math.cos(Math.PI / 4), 14)
    } finally { await lease.release() }
  })

  it.each([undefined, 0, 30])('preserves override presence for %s degrees', async presentation => {
    const base = await rotationCorpus()
    const lease = createCandidateWorldSceneLease({ ...base, semantic: { ...base.semantic, objects: [{
      kind: 'feature', objectId: 7, position: { x: 0.5, y: 0.5, z: 0 }, rotation: 30,
      nativeRotationUnit: 'degrees', ...(presentation === undefined ? {} : { presentationRotation: presentation }),
    }] } }, [], 64)
    try {
      const info = await lease.value.info()
      const page = await lease.value.page({ facet: 'objects', layerId: info.facets.find(f => f.facet === 'objects')!.layerId, limit: 64 })
      const object = page.items.find(item => item.facet === 'objects')
      if (object?.facet !== 'objects') throw new Error('missing placed object')
      expect(Object.hasOwn(object, 'uvwPresentationRotation')).toBe(presentation !== undefined)
      expect(object.uvwRotation?.[1]).toBeCloseTo(Math.sin(Math.PI / 12), 14)
      if (presentation === 0) expect(object.uvwPresentationRotation).toEqual([0, 0, 0, 1])
      if (presentation === 30) expect(object.uvwPresentationRotation).toEqual(object.uvwRotation)
    } finally { await lease.release() }
  })

  it.each([NaN, Infinity, -Infinity])('does not replace valid authored rotation with invalid presentation %s', async presentationRotation => {
    const base = await rotationCorpus()
    const lease = createCandidateWorldSceneLease({ ...base, semantic: { ...base.semantic, objects: [{
      kind: 'feature', objectId: 7, position: { x: 0.5, y: 0.5, z: 0 }, rotation: 30,
      nativeRotationUnit: 'degrees', presentationRotation,
    }] } }, [], 64)
    try {
      const result = await materializeWorldToUvw(lease.value, { maxPageItems: 64, maxTerrainItems: 64, maxFacetItems: 64, maxOutputBytes: 256000 })
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result))
      const layer = result.document.spaces[0]!.layers.find(layer => layer.kind === 'objects')!
      if (layer.kind !== 'objects') throw new Error('missing objects')
      expect(layer.instances[0]!.rotation[1]).toBeCloseTo(Math.sin(Math.PI / 12), 14)
      expect(layer.instances[0]).not.toHaveProperty('presentationRotation')
      expect(result.lostFields.filter(field => field.path === 'world.objects.presentationRotation')).toEqual([
        { path: 'world.objects.presentationRotation', count: 1 },
      ])
    } finally { await lease.release() }
  })

  it('keeps both orientations through encoded UVW, reopen and rematerialize', async () => {
    const base = await rotationCorpus()
    const lease = createCandidateWorldSceneLease({ ...base, semantic: { ...base.semantic, objects: [{
      kind: 'feature', objectId: 7, position: { x: 0.5, y: 0.5, z: 0 }, rotation: 30,
      presentationRotation: 90, nativeRotationUnit: 'degrees', nativeRotationSense: 'counter-clockwise',
    }] } }, [], 64)
    const limits = { maxPageItems: 64, maxTerrainItems: 64, maxFacetItems: 64, maxOutputBytes: 256000 }
    try {
      const result = await materializeWorldToUvw(lease.value, limits)
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result))
      const doc = parseUvwProfile(result.bytes)
      const layer = doc.spaces[0]!.layers.find(layer => layer.kind === 'objects')!
      if (layer.kind !== 'objects') throw new Error('missing objects')
      expect(layer.instances[0]!.rotation).toEqual([0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)])
      expect(layer.instances[0]!.presentationRotation).toEqual([0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)])
      expect(result.lostFields.map(field => field.path)).not.toContain('world.objects.presentationRotation')
      const reopened = createUvwWorldSceneSource(doc, { snapshotId: 'rotation-reopen', maxPageSize: 64 })
      const again = await materializeWorldToUvw(reopened, limits)
      if (again.state !== 'materialized') throw new Error(JSON.stringify(again))
      expect(again.bytes).toEqual(result.bytes)
      // Optional private verification output; default test runs perform no file writes.
      const witness = process.env['ROTATION_WITNESS_FILE']
      if (witness !== undefined) await writeFile(witness, result.bytes)
    } finally { await lease.release() }
  })
})
