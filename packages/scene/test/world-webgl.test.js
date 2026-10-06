import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlCameraFrame,
  createWorldWebGlTransparentDrawPlan,
  createWorldWebGlPlan,
  orbitWorldWebGlCamera,
  panWorldWebGlCamera,
  pickWorldWebGl,
  zoomWorldWebGlCamera,
} from '../src/world/webgl.js'

describe('common world WebGL plan', () => {
  it('meshes terrain, water, cliffs, navigation, regions and transformed model instances', () => {
    const terrain = Array.from({ length: 4 }, (_, index) => ({
      facet: 'terrain',
      id: `t:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x: index % 2,
      y: Math.floor(index / 2),
      heightBase: index,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x: index % 2, y: index, z: -Math.floor(index / 2) },
    }))
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        ...terrain.map(item => ({
          facet: 'terrain-materials',
          id: `m:${item.id}`,
          layerId: 'materials',
          coordinateSpaceId: 'height-grid',
          lod: 'exact',
          x: item.x,
          y: item.y,
          textureIndex: item.x,
        })),
        {
          facet: 'water',
          id: 'water',
          layerId: 'water',
          coordinateSpaceId: 'uvw',
          zoneId: 1,
          templateId: 'water',
          minimum: { x: 0, y: 0 },
          maximum: { x: 1, y: 1 },
          uvwMinimum: { x: 0, z: -1 },
          uvwMaximum: { x: 1, z: 0 },
          uvwElevation: 2,
        },
        {
          facet: 'cliffs',
          id: 'c:0',
          layerId: 'cliffs',
          coordinateSpaceId: 'height-grid',
          lod: 'exact',
          x: 0,
          y: 0,
          level: 0,
          authored: true,
        },
        {
          facet: 'cliffs',
          id: 'c:1',
          layerId: 'cliffs',
          coordinateSpaceId: 'height-grid',
          lod: 'exact',
          x: 1,
          y: 0,
          level: 1,
          authored: true,
        },
        {
          facet: 'objects',
          id: 'object',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'unit',
          objectId: 7,
          position: { x: 0, y: 0, z: 0 },
          uvwPosition: { x: 4, y: 5, z: 6 },
          uvwRotation: [0, 0, 0, 1],
          uvwScale: { x: 2, y: 2, z: 2 },
          resourceId: 'model',
        },
        {
          facet: 'navigation',
          id: 'navigation',
          layerId: 'navigation',
          coordinateSpaceId: 'uvw',
          lod: 'exact',
          x: 0,
          y: 0,
          flags: 1,
          uvwPosition: { x: 0, y: 0, z: 0 },
        },
        {
          facet: 'gateways',
          id: 'gateway:west',
          layerId: 'gateways',
          coordinateSpaceId: 'uvw',
          x1: 0,
          y1: 0,
          x2: 1,
          y2: 0,
          uvwStart: { x: 0, y: 0, z: 0 },
          uvwEnd: { x: 1, y: 0, z: 0 },
        },
        {
          facet: 'regions',
          id: 'region',
          layerId: 'regions',
          coordinateSpaceId: 'uvw',
          regionId: 1,
          name: 'region',
          shapes: [],
          uvwShapes: [{ kind: 'circle', center: { x: 0, y: 0 }, radius: 1, rawParameters: {} }],
        },
      ],
      models: new Map([
        [
          'model',
          {
            state: 'converted',
            sourceKey: 'model',
            diagnostics: [],
            complete: true,
            meshes: [],
            primitives: [
              {
                id: 'triangle',
                topology: 'triangles',
                positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
              },
            ],
          },
        ],
      ]),
    })
    const { minimum, maximum } = plan.bounds
    assert.deepEqual(plan.stats, {
      terrainTriangles: 2,
      terrainTexturedTriangles: 0,
      terrainDecalTriangles: 0,
      terrainSplatFallbackCells: 0,
      waterPolygons: 1,
      cliffEdges: 1,
      cliffTriangles: 2,
      objectInstances: 1,
      programObjects: 0,
      fallbackObjects: 1,
      modelTriangles: 1,
      navigationSamples: 1,
      gatewaySegments: 1,
      regionShapes: 1,
      diagnosticPlaceholders: 0,
      shadowCasterTriangles: 5,
      shadowMapSize: 0,
      // the camera frame: the middle of the bounds and 0.65 of their diagonal
      frame: {
        center: [0, 1, 2].map(axis => (minimum[axis] + maximum[axis]) / 2),
        radius: Math.hypot(...[0, 1, 2].map(axis => maximum[axis] - minimum[axis])) * 0.65,
      },
    })
    assert.equal(plan.opaqueTriangles.positions.length / 9, 5)
    assert.equal(plan.transparentTriangles.positions.length / 9, 2)
    assert.deepEqual(plan.waterSurfaceDepth, plan.transparentTriangles.positions)
    assert.equal(plan.lines.positions.length / 6, 34)
    assert.equal(plan.points.positions.length / 3, 1)
    assert.deepEqual(
      Array.from(plan.opaqueTriangles.positions.slice(-9)),
      [4, 5, 6, 6, 5, 6, 4, 7, 6],
    )
  })

  it('uses explicit diagnostic points when a model resource is unavailable', () => {
    const input = {
      items: [
        {
          facet: 'objects',
          id: 'object',
          layerId: 'objects',
          coordinateSpaceId: 'native',
          kind: 'feature',
          objectId: 1,
          position: { x: 2, y: 3, z: 4 },
        },
      ],
      selectedObjectId: 1,
      previewPosition: { x: 5, y: 6, z: 7 },
    }
    const plan = createWorldWebGlPlan(input)
    assert.equal(plan.stats.diagnosticPlaceholders, 1)
    assert.deepEqual(Array.from(plan.points.positions), [5, 7, 6])
    assert.deepEqual(
      Array.from(plan.points.colors).map(value => Math.round(value * 10) / 10),
      [1, 0.9, 0.1, 1],
    )
    const center = pickWorldWebGl(input, { x: 360, y: 240, width: 720, height: 480 })
    assert.equal(center?.kind, 'object')
    assert.equal(center?.objectId, 1)
  })

  it('reads CWater ColorFallOff as a saturation rate per unit of depth', () => {
    const terrain = Array.from({ length: 4 }, (_, index) => ({
      facet: 'terrain',
      id: `terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'uvw',
      lod: 'exact',
      x: index % 2,
      y: Math.floor(index / 2),
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x: index % 2, y: 0, z: -Math.floor(index / 2) },
    }))
    const water = {
      facet: 'water',
      id: 'water',
      layerId: 'water',
      coordinateSpaceId: 'uvw',
      zoneId: 0,
      templateId: 'Avernus',
      materialId: 'avernus',
      minimum: { x: 0, y: 0 },
      maximum: { x: 1, y: 1 },
      uvwMinimum: { x: 0, z: -1 },
      uvwMaximum: { x: 1, z: 0 },
      uvwElevation: 1,
    }
    const plan = createWorldWebGlPlan({
      items: [...terrain, water],
      waterMaterials: [{ materialId: 'avernus', color: [0, 0.5, 0.25, 0.332], colorFalloff: 0.1 }],
    })
    // One unit deep at rate 0.1: saturation 1 − e^−0.1, so the sea stays translucent over its floor.
    const saturation = 1 - Math.exp(-0.1)
    const alphas = plan.transparentTriangles.colors.filter((_, index) => index % 4 === 3)
    assert.ok(alphas.length > 0)
    for (const alpha of alphas) assert.ok(Math.abs(alpha - (0.332 + 0.668 * saturation)) < 1e-6)
  })

  it('clips SC2-style water against terrain and scrolls its surface UVs deterministically', () => {
    const terrain = Array.from({ length: 4 }, (_, index) => ({
      facet: 'terrain',
      id: `terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'uvw',
      lod: 'exact',
      x: index % 2,
      y: Math.floor(index / 2),
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: {
        x: index % 2,
        y: index % 2,
        z: -Math.floor(index / 2),
      },
    }))
    const water = {
      facet: 'water',
      id: 'water',
      layerId: 'water',
      coordinateSpaceId: 'uvw',
      zoneId: 0,
      templateId: 'BelShirWater',
      materialId: 'water-material',
      minimum: { x: 0, y: 0 },
      maximum: { x: 1, y: 1 },
      uvwMinimum: { x: 0, z: -1 },
      uvwMaximum: { x: 1, z: 0 },
      uvwElevation: 0.5,
    }
    const texture = {
      id: 'water.png',
      width: 1,
      height: 1,
      rgba: Uint8Array.of(64, 128, 255, 180),
    }
    const waterMaterials = [
      {
        materialId: 'water-material',
        classification: 'water',
        shorelineMode: 'terrain-clipped',
        color: [0.12, 0.3, 0.45, 0.55],
        baseColorResourceId: texture.id,
        uvScale: [1, 2, 3, 4],
        scroll: [0.25, 0.5, -0.25, -0.5],
        colorFalloff: 0.1,
        receiveShadows: true,
      },
    ]
    const atZero = createWorldWebGlPlan({
      items: [...terrain, water],
      waterMaterials,
      terrainTextures: new Map([[texture.id, texture]]),
      timeSeconds: 0,
    })
    const atTwo = createWorldWebGlPlan({
      items: [...terrain, water],
      waterMaterials,
      terrainTextures: new Map([[texture.id, texture]]),
      timeSeconds: 2,
    })
    assert.equal(atZero.transparentTriangles.positions.length, 0)
    assert.equal(atZero.transparentTexturedTriangles.length, 1)
    assert.equal(atZero.transparentTexturedTriangles[0].receiveShadows, true)
    assert.ok(atZero.transparentTexturedTriangles[0].positions.length > 0)
    assert.ok(atZero.waterSurfaceDepth.length > 0)
    assert.ok(atZero.waterSurfaceDepth.every((value, index) => index % 3 !== 1 || value === 0.5))
    // The ground rises with x and the surface sits at 0.5: water stops a hair (0.005) below it.
    assert.ok(
      Math.max(
        ...atZero.transparentTexturedTriangles[0].positions.filter((_, index) => index % 3 === 0),
      ) <= 0.495001,
    )
    const firstUv = Array.from(
      atZero.transparentTexturedTriangles[0].textureCoordinates.slice(0, 2),
    )
    const movedUv = Array.from(atTwo.transparentTexturedTriangles[0].textureCoordinates.slice(0, 2))
    const firstSecondaryUv = Array.from(
      atZero.transparentTexturedTriangles[0].secondaryTextureCoordinates.slice(0, 2),
    )
    const movedSecondaryUv = Array.from(
      atTwo.transparentTexturedTriangles[0].secondaryTextureCoordinates.slice(0, 2),
    )
    assert.ok(Math.abs(movedUv[0] - firstUv[0] - 0.5) < 1e-6)
    assert.ok(Math.abs(movedUv[1] - firstUv[1] - 1) < 1e-6)
    assert.ok(Math.abs(movedSecondaryUv[0] - firstSecondaryUv[0] + 0.5) < 1e-6)
    assert.ok(Math.abs(movedSecondaryUv[1] - firstSecondaryUv[1] + 1) < 1e-6)
  })

  it('samples repeated UVM instances with independent animation clocks', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const model = {
      state: 'converted',
      sourceKey: 'animated-model',
      diagnostics: [],
      complete: true,
      nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        },
      ],
      skeleton: [
        {
          partId: 'triangle',
          boneIndex: 0,
          boneName: 'root',
          provenance: 'direct',
          hierarchyId: 'skin',
          parentBoneIndex: null,
          nodeId: 'root',
          localPose: {
            translation: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          inverseBindMatrix: identity,
        },
      ],
      animations: [
        {
          id: 'move',
          name: 'Move',
          kind: 'animation',
          provenance: 'direct',
          frames: 2,
          durationSeconds: 1,
          looping: true,
          channels: [
            {
              target: 'root',
              kind: 'translation',
              firstFrame: 0,
              lastFrame: 1,
              interpolation: 'linear',
              samples: [
                { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
                { frame: 1, timeSeconds: 1, value: [2, 0, 0] },
              ],
            },
          ],
        },
      ],
    }
    const item = objectId => ({
      facet: 'objects',
      id: `object:${objectId}`,
      layerId: 'objects',
      coordinateSpaceId: 'uvw',
      kind: 'unit',
      objectId,
      position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0, y: 0, z: 0 },
      resourceId: 'animated-model',
    })
    const plan = createWorldWebGlPlan({
      items: [item(1), item(2)],
      models: new Map([['animated-model', model]]),
      animationTimes: new Map([
        [1, 0],
        [2, 0.5],
      ]),
    })
    assert.equal(plan.stats.modelTriangles, 2)
    assert.deepEqual(
      Array.from(plan.opaqueTriangles.positions.slice(0, 9)),
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
    )
    assert.deepEqual(
      Array.from(plan.opaqueTriangles.positions.slice(9, 18)),
      [1, 0, 0, 2, 0, 0, 1, 1, 0],
    )
  })

  it('honors portable primitive visibility without replacing an intentionally hidden model', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const model = {
      state: 'converted',
      sourceKey: 'visibility-model',
      diagnostics: [],
      complete: true,
      nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        },
      ],
      animations: [
        {
          id: 'toggle',
          name: 'Toggle',
          kind: 'animation',
          provenance: 'direct',
          frames: 2,
          channels: [
            {
              target: 'triangle',
              kind: 'visibility',
              firstFrame: 0,
              lastFrame: 1,
              interpolation: 'step',
              samples: [
                { frame: 0, timeSeconds: 0, value: [1] },
                { frame: 1, timeSeconds: 1, value: [0] },
              ],
            },
          ],
        },
      ],
    }
    const item = {
      facet: 'objects',
      id: 'object:1',
      layerId: 'objects',
      coordinateSpaceId: 'uvw',
      kind: 'unit',
      objectId: 1,
      position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0, y: 0, z: 0 },
      resourceId: 'visibility-model',
    }
    const at = time =>
      createWorldWebGlPlan({
        items: [item],
        models: new Map([['visibility-model', model]]),
        animationTimes: new Map([[1, time]]),
      })
    assert.equal(at(0).stats.modelTriangles, 1)
    assert.equal(at(1).stats.modelTriangles, 0)
    assert.equal(at(1).stats.diagnosticPlaceholders, 0)
    assert.equal(at(1).points.positions.length, 0)
  })

  it('joins UVM material layers, decoded resources and authored UV coordinates', () => {
    const plan = createWorldWebGlPlan({
      items: [
        {
          facet: 'objects',
          id: 'textured-object',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'structure',
          objectId: 3,
          position: { x: 0, y: 0, z: 0 },
          uvwPosition: { x: 0, y: 0, z: 0 },
          resourceId: 'textured-model',
        },
      ],
      models: new Map([
        [
          'textured-model',
          {
            state: 'converted',
            sourceKey: 'textured-model-source',
            diagnostics: [],
            complete: true,
            meshes: [],
            primitives: [
              {
                id: 'triangle',
                topology: 'triangles',
                materialId: 'surface',
                positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
              },
            ],
            materials: [
              {
                id: 'surface',
                layers: [
                  { slot: 'diffuse', resourceId: 'surface.png', uvSource: 0 },
                  { slot: 'normal', resourceId: 'surface-normal.png', uvSource: 0 },
                ],
              },
            ],
            textures: [
              {
                id: 'surface.png',
                width: 1,
                height: 1,
                rgba: Uint8Array.of(20, 120, 220, 255),
              },
              {
                id: 'surface-normal.png',
                width: 1,
                height: 1,
                rgba: Uint8Array.of(128, 128, 255, 255),
              },
            ],
          },
        ],
      ]),
    })
    assert.equal(plan.opaqueTriangles.positions.length, 0)
    assert.equal(plan.texturedTriangles.length, 1)
    assert.deepEqual(Array.from(plan.texturedTriangles[0].textureCoordinates), [0, 0, 1, 0, 0, 1])
    assert.deepEqual(Array.from(plan.texturedTriangles[0].texture.rgba), [20, 120, 220, 255])
    assert.equal(plan.texturedTriangles[0].normalTexture?.id, 'surface-normal.png')
  })

  it('routes alpha-tested game materials and shadows through the standalone compiler with team color', () => {
    const materialLayer = {
      slot: 'diffuse',
      texturePath: 'team.dds',
      constantColor: { value: [1, 1, 1, 1] },
      uvSource: 0,
      channels: 0,
      op: 6,
      teamColorMode: 1,
      invert: false,
      clampResult: true,
      wrapX: true,
      wrapY: true,
    }
    const plan = createWorldWebGlPlan({
      items: [
        {
          facet: 'objects',
          id: 'team-object',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'unit',
          objectId: 7,
          player: 3,
          presentationTeamColor: [0.8, 0.8, 0.8],
          position: { x: 0, y: 0, z: 0 },
          uvwPosition: { x: 4, y: 2, z: 6 },
          resourceId: 'team-model',
        },
      ],
      teamColors: new Map([[3, [0.1, 0.7, 0.9]]]),
      models: new Map([
        [
          'team-model',
          {
            state: 'converted',
            sourceKey: 'team-model',
            diagnostics: [],
            complete: true,
            meshes: [],
            primitives: [
              {
                id: 'triangle',
                topology: 'triangles',
                materialId: 'surface',
                positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
              },
            ],
            materials: [
              {
                id: 'surface',
                layers: [{ slot: 'diffuse', resourceId: 'team.dds', uvSource: 0 }],
                shader: {
                  id: 'modkit.render-material.v1',
                  parameters: {
                    renderModel: {
                      version: 1,
                      standard: {
                        layers: { diffuse: materialLayer },
                        blendMode: 0,
                        priority: 0,
                        specularity: 10,
                        specMult: 1,
                        emisMult: 1,
                        specMode: 0,
                        alphaTestThreshold: 0.5,
                        twoSided: false,
                        unshaded: true,
                        doubleLambert: false,
                        clampOutput: false,
                        usesVertexColor: false,
                        usesVertexAlpha: false,
                      },
                    },
                  },
                },
              },
            ],
            textures: [
              {
                id: 'team.dds',
                width: 1,
                height: 1,
                rgba: Uint8Array.of(40, 80, 120, 128),
              },
            ],
          },
        ],
      ]),
    })
    assert.equal(plan.modelMaterialScenes.length, 1)
    assert.equal(plan.texturedTriangles.length, 0)
    const scene = plan.modelMaterialScenes[0]
    assert.equal(scene.shadowPrimitives.length, 1)
    assert.equal(scene.programs.get('surface').passes[0].blend, 'alpha-test')
    assert.deepEqual(scene.programs.get('surface').passes[0].uniforms.u_teamColor, [0.8, 0.8, 0.8])
    assert.deepEqual(Array.from(scene.primitives[0].transform.slice(12, 15)), [4, 2, 6])
  })

  it('preserves composite vocabulary and advances a default Stand material sequence', () => {
    const layer = (slot, animated = false) => ({
      slot,
      texturePath: 'water.png',
      constantColor: { value: [1, 1, 1, 1] },
      uvSource: 0,
      channels: slot === 'alpha1' ? 4 : 0,
      op: 2,
      teamColorMode: 0,
      invert: false,
      clampResult: true,
      wrapX: true,
      wrapY: true,
      ...(animated
        ? {
            colorMultiply: {
              value: 0,
              sequenceTracks: [{
                sequenceIndex: 0,
                track: {
                  globalSeqId: null,
                  lineType: 1,
                  keys: [
                    { frame: 0, vector: [0] },
                    { frame: 2, vector: [1] },
                  ],
                },
              }],
            },
          }
        : {}),
    })
    const standard = {
      layers: { diffuse: layer('diffuse'), alpha1: layer('alpha1', true) },
      blendMode: 1,
      priority: 0,
      specularity: 10,
      specMult: 1,
      emisMult: 1,
      specMode: 0,
      alphaTestThreshold: 0,
      twoSided: false,
      unshaded: true,
      doubleLambert: false,
      clampOutput: false,
      usesVertexColor: false,
      usesVertexAlpha: false,
    }
    const item = {
      facet: 'objects', id: 'water', layerId: 'objects', coordinateSpaceId: 'uvw',
      kind: 'doodad', objectId: 12, position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0, y: 0, z: 0 }, resourceId: 'water-model',
    }
    const model = {
      state: 'converted', sourceKey: 'water-model', diagnostics: [], complete: true, meshes: [],
      primitives: [{
        id: 'water-plane', topology: 'triangles', materialId: 'water',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
      }],
      animations: [{
        id: 'stand', name: 'Stand', kind: 'animation', provenance: 'direct', frames: 2,
        durationSeconds: 4, looping: true, sequenceIndex: 0, channels: [],
      }],
      materials: [{
        id: 'water', blendMode: 'blend',
        layers: [{ slot: 'diffuse', resourceId: 'water.png', uvSource: 0 }, { slot: 'alpha1', resourceId: 'water.png', uvSource: 0 }],
        shader: { id: 'modkit.render-material.v1', parameters: {
          renderModel: { version: 1, layers: [], composite: { priority: 0, passes: [{ material: standard, alphaFactor: { value: 1 } }] } },
        } },
      }],
      textures: [{ id: 'water.png', width: 1, height: 1, rgba: Uint8Array.of(80, 160, 200, 255) }],
    }
    const at = timeSeconds => createWorldWebGlPlan({
      items: [item], models: new Map([['water-model', model]]), timeSeconds,
    })
    const initial = at(0), animated = at(2)
    assert.equal(initial.modelMaterialScenes.length, 1)
    assert.equal(initial.transparentTexturedTriangles.length, 0)
    assert.equal(initial.modelMaterialScenes[0].programs.get('water').passes[0].blend, 'blend')
    assert.equal(initial.modelMaterialScenes[0].programs.get('water').passes[0].uniforms.u_alpha1Multiply, 0)
    assert.equal(animated.modelMaterialScenes[0].programs.get('water').passes[0].uniforms.u_alpha1Multiply, 1)
  })

  it('keeps alpha cutoffs and common/native shadow policy on opaque textured materials', () => {
    const item = (objectId, resourceId) => ({
      facet: 'objects',
      id: `cutout:${objectId}`,
      layerId: 'objects',
      coordinateSpaceId: 'uvw',
      kind: 'doodad',
      objectId,
      position: { x: objectId, y: 0, z: 0 },
      uvwPosition: { x: objectId, y: 0, z: 0 },
      resourceId,
    })
    const model = material => ({
      state: 'converted',
      sourceKey: material.id,
      diagnostics: [],
      complete: true,
      meshes: [],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          materialId: material.id,
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
        },
      ],
      materials: [material],
      textures: [
        {
          id: 'cutout.png',
          width: 1,
          height: 1,
          rgba: Uint8Array.of(255, 255, 255, 64),
        },
      ],
    })
    const layers = [{ slot: 'diffuse', resourceId: 'cutout.png', uvSource: 0 }]
    const plan = createWorldWebGlPlan({
      items: [item(1, 'common-mask'), item(2, 'render-model-mask'), item(3, 'untextured')],
      models: new Map([
        [
          'common-mask',
          model({
            id: 'common',
            alphaMode: 'mask',
            alphaCutoff: 0.4,
            castShadows: false,
            // unlit: the fallback path draws it (a glTF program lights its material, gltf-program.ts)
            unlit: true,
            layers,
          }),
        ],
        [
          'render-model-mask',
          model({
            id: 'render-model',
            blendMode: 'opaque',
            flagNames: ['no-shadows-receive'],
            layers,
            shader: {
              id: 'modkit.render-material.v1',
              parameters: {
                renderModel: { version: 1, standard: { alphaTestThreshold: 0.6 } },
              },
            },
          }),
        ],
        ['untextured', model({ id: 'untextured', receiveShadows: false })],
      ]),
    })
    assert.equal(plan.transparentTexturedTriangles.length, 0)
    assert.deepEqual(plan.texturedTriangles.map(batch => batch.alphaCutoff).sort(), [0.4, 0.6])
    assert.deepEqual(
      plan.texturedTriangles.map(batch => [batch.castShadows, batch.receiveShadows]),
      [
        [false, true],
        [true, false],
      ],
    )
    assert.equal(plan.shadowControlledOpaqueTriangles.length, 1)
    assert.equal(plan.shadowControlledOpaqueTriangles[0].castShadows, true)
    assert.equal(plan.shadowControlledOpaqueTriangles[0].receiveShadows, false)
    assert.equal(plan.stats.shadowCasterTriangles, 2)
  })

  it('keeps exact blend and additive model materials out of the opaque textured pass', () => {
    const item = (objectId, resourceId, x) => ({
      facet: 'objects',
      id: `object:${objectId}`,
      layerId: 'objects',
      coordinateSpaceId: 'uvw',
      kind: 'unit',
      objectId,
      position: { x, y: 0, z: 0 },
      uvwPosition: { x, y: 0, z: 0 },
      resourceId,
    })
    const model = blendMode => ({
      state: 'converted',
      sourceKey: blendMode,
      diagnostics: [],
      complete: true,
      meshes: [],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          materialId: 'surface',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
        },
      ],
      materials: [
        {
          id: 'surface',
          blendMode,
          layers: [{ slot: 'diffuse', resourceId: 'surface.png', uvSource: 0 }],
          shader: {
            id: 'modkit.render-material.v1',
            parameters: {
              renderModel: {
                version: 1,
                standard: {
                  layers: {
                    diffuse: {
                      slot: 'diffuse',
                      texturePath: 'surface.png',
                      constantColor: { value: [1, 1, 1, 1] },
                      uvSource: 0,
                      channels: 0,
                      op: 6,
                      teamColorMode: 0,
                      invert: false,
                      clampResult: true,
                      wrapX: true,
                      wrapY: true,
                    },
                  },
                  blendMode: blendMode === 'blend' ? 1 : 2,
                  priority: 0,
                  specularity: 10,
                  specMult: 1,
                  emisMult: 1,
                  specMode: 0,
                  alphaTestThreshold: 0,
                  twoSided: false,
                  unshaded: true,
                  doubleLambert: false,
                  clampOutput: false,
                  usesVertexColor: false,
                  usesVertexAlpha: false,
                },
              },
            },
          },
        },
      ],
      textures: [
        {
          id: 'surface.png',
          width: 1,
          height: 1,
          rgba: Uint8Array.of(255, 255, 255, 128),
        },
      ],
    })
    const plan = createWorldWebGlPlan({
      items: [item(1, 'blend-model', 0), item(2, 'additive-model', 2)],
      models: new Map([
        ['blend-model', model('blend')],
        ['additive-model', model('additive')],
      ]),
    })
    assert.equal(plan.texturedTriangles.length, 0)
    assert.equal(plan.transparentTexturedTriangles.length, 0)
    assert.equal(plan.modelMaterialScenes.length, 2)
    assert.deepEqual(
      plan.modelMaterialScenes.map(scene => scene.programs.get('surface').passes[0].blend).sort(),
      ['additive', 'blend'],
    )
    assert.equal(plan.stats.modelTriangles, 2)
    assert.equal(plan.stats.shadowCasterTriangles, 0)
  })

  it('sorts transparent water and material triangles globally back-to-front for the camera', () => {
    const texture = {
      id: 'surface.png',
      width: 1,
      height: 1,
      rgba: Uint8Array.of(255, 255, 255, 128),
    }
    const transparentModel = {
      state: 'converted',
      sourceKey: 'blend',
      diagnostics: [],
      complete: true,
      meshes: [],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          materialId: 'surface',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
        },
      ],
      materials: [
        {
          id: 'surface',
          blendMode: 'blend',
          // unlit: the fallback path draws it (a glTF program lights its material, gltf-program.ts)
          unlit: true,
          layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
        },
      ],
      textures: [texture],
    }
    const plan = createWorldWebGlPlan({
      items: [
        {
          facet: 'water',
          id: 'water',
          layerId: 'water',
          coordinateSpaceId: 'uvw',
          zoneId: 1,
          templateId: 'water',
          minimum: { x: -5, y: 0 },
          maximum: { x: -4, y: 1 },
          uvwMinimum: { x: -5, z: 0 },
          uvwMaximum: { x: -4, z: 1 },
          uvwElevation: 0,
        },
        {
          facet: 'objects',
          id: 'object',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'unit',
          objectId: 1,
          position: { x: 5, y: 0, z: 0 },
          uvwPosition: { x: 5, y: 0, z: 0 },
          resourceId: 'blend-model',
        },
      ],
      models: new Map([['blend-model', transparentModel]]),
    })
    const draws = createWorldWebGlTransparentDrawPlan(plan, {
      ...DEFAULT_WORLD_WEBGL_CAMERA,
      azimuth: 0,
      elevation: 0.04,
    })
    assert.deepEqual(
      draws.map(draw => draw.kind),
      ['untextured', 'textured'],
    )
    assert.deepEqual(
      draws.map(draw => draw.receiveShadows),
      [false, true],
    )
    assert.equal(draws[0].range.count / 3, 2)
    assert.equal(draws[1].range.count / 3, 1)
    assert.equal(
      draws.reduce((count, draw) => count + draw.range.count / 3, 0),
      3,
    )
    // Runs select sorted triangles of the source batch; its vertex buffers are not copied.
    assert.equal(draws[1].batch.positions.length / 9, 1)
  })

  it('draws every resolved component resource of a compound object in one world instance', () => {
    const component = sourceKey => ({
      state: 'converted',
      sourceKey,
      diagnostics: [],
      complete: true,
      meshes: [],
      primitives: [
        {
          id: `${sourceKey}-triangle`,
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        },
      ],
    })
    const plan = createWorldWebGlPlan({
      items: [
        {
          facet: 'objects',
          id: 'compound',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'unit',
          objectId: 9,
          position: { x: 0, y: 0, z: 0 },
          uvwPosition: { x: 0, y: 0, z: 0 },
          resourceIds: ['body', 'tool'],
        },
      ],
      models: new Map([
        ['body', component('body')],
        ['tool', component('tool')],
      ]),
    })
    assert.equal(plan.stats.objectInstances, 1)
    assert.equal(plan.stats.modelTriangles, 2)
    assert.equal(plan.stats.diagnosticPlaceholders, 0)
    assert.equal(plan.picking.objects[0].triangles.length, 18)
  })

  it('places an attached component at the exact sampled parent socket transform', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const body = {
      state: 'converted',
      sourceKey: 'body',
      diagnostics: [],
      complete: true,
      nodes: [
        { id: 'root', childIds: ['socket'], meshIds: ['body-mesh'], transform: identity },
        {
          id: 'socket',
          childIds: [],
          meshIds: [],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, 1, 1],
        },
      ],
      meshes: [{ id: 'body-mesh', primitiveIds: ['body-triangle'] }],
      primitives: [
        {
          id: 'body-triangle',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        },
      ],
      sockets: [{ id: 'connector-1', nodeId: 'socket', role: 'attach' }],
    }
    const tool = {
      state: 'converted',
      sourceKey: 'tool',
      diagnostics: [],
      complete: true,
      meshes: [],
      primitives: [
        {
          id: 'tool-triangle',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        },
      ],
    }
    const plan = createWorldWebGlPlan({
      items: [
        {
          facet: 'objects',
          id: 'attached',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'unit',
          objectId: 10,
          position: { x: 0, y: 0, z: 0 },
          uvwPosition: { x: 0, y: 0, z: 0 },
          resourceIds: ['body', 'tool'],
          modelComponents: [
            { id: 'body-instance', resourceId: 'body' },
            {
              id: 'tool-instance',
              resourceId: 'tool',
              parentId: 'body-instance',
              parentSocketId: 'connector-1',
              rotation: [0, 0, 1, 0],
            },
          ],
        },
      ],
      models: new Map([
        ['body', body],
        ['tool', tool],
      ]),
    })
    assert.equal(plan.stats.modelTriangles, 2)
    assert.deepEqual(
      Array.from(plan.opaqueTriangles.positions.slice(9)),
      [3, 2, 1, 2, 2, 1, 3, 1, 1],
    )
    assert.deepEqual(
      Array.from(plan.picking.objects[0].triangles.slice(9)),
      [3, 2, 1, 2, 2, 1, 3, 1, 1],
    )
  })

  it('keeps a placeholder for an object whose only loaded component waits for an unloaded parent', () => {
    const tool = {
      state: 'converted',
      sourceKey: 'tool',
      diagnostics: [],
      complete: true,
      meshes: [],
      primitives: [
        {
          id: 'tool-triangle',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        },
      ],
    }
    const plan = createWorldWebGlPlan({
      items: [
        {
          facet: 'objects',
          id: 'attached',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'structure',
          objectId: 11,
          position: { x: 0, y: 0, z: 0 },
          uvwPosition: { x: 0, y: 0, z: 0 },
          resourceIds: ['body', 'tool'],
          modelComponents: [
            { id: 'body-instance', resourceId: 'body' },
            {
              id: 'tool-instance',
              resourceId: 'tool',
              parentId: 'body-instance',
              parentSocketId: 'connector-1',
            },
          ],
        },
      ],
      // The parent model was not admitted (budget), only the attached child was converted.
      models: new Map([['tool', tool]]),
    })
    assert.equal(plan.stats.modelTriangles, 0)
    assert.equal(plan.stats.diagnosticPlaceholders, 1)
    assert.equal(plan.picking.objects[0].placeholder, true)
  })

  it('renders terrain from host-decoded material textures and authored tile UV transforms', () => {
    const terrain = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y], index) => ({
      facet: 'terrain',
      id: `terrain-texture:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: y },
    }))
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        {
          facet: 'terrain-materials',
          id: 'terrain-material:0',
          layerId: 'materials',
          coordinateSpaceId: 'height-grid',
          lod: 'exact',
          x: 0,
          y: 0,
          textureIndex: 7,
          weights: [{ materialId: 'grass', weight: 1 }],
          uvTransform: { offset: [0, 0], scale: [-1, 1], rotation: 0 },
        },
      ],
      terrainMaterials: [
        {
          materialId: 'grass',
          sourceIndex: 7,
          baseColorResourceId: 'terrain/grass.dds',
          normalResourceId: 'terrain/grass-normal.dds',
        },
      ],
      terrainTextures: new Map([
        [
          'terrain/grass.dds',
          {
            id: 'terrain/grass.dds',
            width: 1,
            height: 1,
            rgba: Uint8Array.of(12, 80, 28, 255),
          },
        ],
        [
          'terrain/grass-normal.dds',
          {
            id: 'terrain/grass-normal.dds',
            width: 1,
            height: 1,
            rgba: Uint8Array.of(128, 128, 255, 255),
          },
        ],
      ]),
    })
    assert.equal(plan.stats.terrainTriangles, 2)
    assert.equal(plan.stats.terrainTexturedTriangles, 2)
    assert.equal(plan.opaqueTriangles.positions.length, 0)
    assert.equal(plan.texturedTriangles.length, 1)
    // The flip turns the tile over on its own cell (centre rule): u' = 1 - u.
    assert.deepEqual(
      Array.from(plan.texturedTriangles[0].textureCoordinates),
      [1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
    )
    assert.deepEqual(Array.from(plan.texturedTriangles[0].texture.rgba), [12, 80, 28, 255])
    assert.deepEqual(Array.from(plan.texturedTriangles[0].normalTexture.rgba), [128, 128, 255, 255])
  })

  it('retains normalized multi-layer terrain splat weights in GPU batches', () => {
    const terrain = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y], index) => ({
      facet: 'terrain',
      id: `splat-terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: y },
    }))
    const texture = (id, rgba) => ({ id, width: 1, height: 1, rgba: Uint8Array.from(rgba) })
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        {
          facet: 'terrain-materials',
          id: 'splat:0',
          layerId: 'materials',
          coordinateSpaceId: 'height-grid',
          lod: 'exact',
          x: 0,
          y: 0,
          textureIndex: 0,
          weights: [
            { materialId: 'grass', weight: 0.8 },
            { materialId: 'dirt', weight: 0.2 },
          ],
        },
      ],
      terrainMaterials: [
        {
          materialId: 'grass',
          baseColorResourceId: 'grass.dds',
          normalResourceId: 'grass-normal.dds',
        },
        { materialId: 'dirt', baseColorResourceId: 'dirt.dds' },
      ],
      terrainTextures: new Map([
        ['grass.dds', texture('grass.dds', [20, 100, 30, 255])],
        ['grass-normal.dds', texture('grass-normal.dds', [128, 160, 240, 255])],
        ['dirt.dds', texture('dirt.dds', [100, 70, 30, 255])],
      ]),
    })
    assert.equal(plan.stats.terrainTexturedTriangles, 2)
    assert.equal(plan.texturedTriangles.length, 0)
    assert.equal(plan.splatTriangles.length, 1)
    assert.equal(plan.splatTriangles[0].textures.length, 2)
    assert.deepEqual(
      plan.splatTriangles[0].normalTextures.map(texture => texture?.id),
      ['grass-normal.dds', undefined],
    )
    assert.deepEqual(
      Array.from(plan.splatTriangles[0].textureWeights0.slice(0, 4)).map(
        value => Math.round(value * 10) / 10,
      ),
      [0.8, 0.2, 0, 0],
    )
  })

  it('builds a full-grid GPU splat batch from exact RGBA weight rasters', () => {
    const terrain = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y], index) => ({
      facet: 'terrain',
      id: `raster-terrain:${index}`,
      ambientOcclusion: [0, 0.25, 0.5, 1][index],
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: y },
    }))
    const texture = (id, width, height, rgba) => ({
      id,
      width,
      height,
      rgba: Uint8Array.from(rgba),
    })
    const plan = createWorldWebGlPlan({
      items: terrain,
      terrainMaterials: [
        {
          materialId: 'grass',
          baseColorResourceId: 'grass.dds',
          normalResourceId: 'grass-normal.dds',
        },
        {
          materialId: 'dirt',
          baseColorResourceId: 'dirt.dds',
          normalResourceId: 'dirt-normal.dds',
        },
      ],
      terrainWeightRasters: [
        {
          resourceId: 'weights.rgba',
          width: 2,
          height: 2,
          materialIds: ['grass', 'dirt'],
          encoding: 'rgba8-unorm',
          normalization: 'sum',
        },
      ],
      terrainTextures: new Map([
        ['grass.dds', texture('grass.dds', 1, 1, [20, 100, 30, 255])],
        ['grass-normal.dds', texture('grass-normal.dds', 1, 1, [128, 128, 255, 255])],
        ['dirt.dds', texture('dirt.dds', 1, 1, [100, 70, 30, 255])],
        [
          'dirt-normal.dds',
          texture('dirt-normal.dds', 2, 1, [160, 128, 240, 255, 96, 128, 240, 255]),
        ],
        [
          'weights.rgba',
          texture(
            'weights.rgba',
            2,
            2,
            [255, 0, 0, 0, 128, 127, 0, 0, 0, 255, 0, 0, 64, 191, 0, 0],
          ),
        ],
      ]),
    })
    assert.equal(plan.stats.terrainTexturedTriangles, 2)
    assert.equal(plan.splatTriangles.length, 1)
    assert.equal(plan.splatTriangles[0].textures.length, 2)
    const batch = plan.splatTriangles[0]
    for (let vertex = 0; vertex < batch.positions.length / 3; vertex++) {
      const index = batch.positions[vertex * 3] + batch.positions[vertex * 3 + 2] * 2
      assert.equal(batch.colors[vertex * 4 + 3], [0, 0.25, 0.5, 1][index])
      assert.deepEqual(Array.from(batch.colors.slice(vertex * 4, vertex * 4 + 3)), [1, 1, 1])
    }
    assert.deepEqual(
      plan.splatTriangles[0].normalTextures.map(texture => texture?.id),
      ['grass-normal.dds', 'dirt-normal.dds'],
    )
    assert.equal(plan.splatTriangles[0].weightTextures.length, 1)
    assert.deepEqual(Array.from(plan.splatTriangles[0].textureWeights0.slice(0, 4)), [0, 0, 0, 0])
    assert.deepEqual(
      Array.from(plan.splatTriangles[0].weightTextureCoordinates),
      [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
    )
    // without baseColorFactor every layer is drawn as its texture: white multipliers
    assert.deepEqual(plan.splatTriangles[0].layerColors, [
      [1, 1, 1],
      [1, 1, 1],
    ])
  })

  it('multiplies each raster-blended layer by its baseColorFactor, the colour alone without a texture', () => {
    const terrain = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y], index) => ({
      facet: 'terrain',
      id: `tinted-terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: y },
    }))
    const texture = (id, rgba) => ({ id, width: 1, height: 1, rgba: Uint8Array.from(rgba) })
    // Roblox: a grey variant ColorMap tinted by Terrain.MaterialColors, and a colour-only material
    const plan = createWorldWebGlPlan({
      items: terrain,
      terrainMaterials: [
        { materialId: 'grass', baseColorResourceId: 'grass.png', baseColorFactor: [0.68, 0.52, 0.24, 1] },
        { materialId: 'mud', baseColorFactor: [0.43, 0.24, 0.16, 1] },
      ],
      terrainWeightRasters: [
        {
          resourceId: 'weights',
          width: 1,
          height: 1,
          materialIds: ['grass', 'mud'],
          encoding: 'rgba8-unorm',
          normalization: 'sum',
        },
      ],
      terrainTextures: new Map([
        ['grass.png', texture('grass.png', [128, 128, 128, 255])],
        ['weights', texture('weights', [128, 127, 0, 0])],
      ]),
    })
    assert.equal(plan.splatTriangles.length, 1)
    const batch = plan.splatTriangles[0]
    assert.deepEqual(
      batch.textures.map(item => item.id),
      ['grass.png', 'modkit.world/white-terrain-layer'],
    )
    assert.deepEqual(batch.layerColors, [
      [0.68, 0.52, 0.24],
      [0.43, 0.24, 0.16],
    ])
  })

  it('ray-picks exact UVM instance triangles and terrain with the render camera', () => {
    const objectInput = {
      items: [
        {
          facet: 'objects',
          id: 'object',
          layerId: 'objects',
          coordinateSpaceId: 'uvw',
          kind: 'unit',
          objectId: 9,
          position: { x: 0, y: 0, z: 0 },
          uvwPosition: { x: 0, y: 0, z: 0 },
          resourceId: 'model',
        },
      ],
      models: new Map([
        [
          'model',
          {
            state: 'converted',
            sourceKey: 'model',
            diagnostics: [],
            complete: true,
            meshes: [],
            primitives: [
              {
                id: 'triangle',
                topology: 'triangles',
                positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
              },
            ],
          },
        ],
      ]),
    }
    const object = pickWorldWebGl(objectInput, { x: 360, y: 240, width: 720, height: 480 })
    assert.equal(object?.kind, 'object')
    assert.equal(object?.objectId, 9)
    assert.ok(object.position.every(value => Math.abs(value) < 1e-8))

    const terrainInput = {
      items: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y], index) => ({
        facet: 'terrain',
        id: `terrain:${index}`,
        layerId: 'terrain',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x,
        y,
        heightBase: 0,
        heightAdjustment: 0,
        mask: 0,
        uvwPosition: { x, y: 0, z: y },
      })),
    }
    const terrain = pickWorldWebGl(terrainInput, {
      x: 360,
      y: 240,
      width: 720,
      height: 480,
    })
    assert.equal(terrain?.kind, 'terrain')
    assert.ok(Math.abs(terrain.position[1]) < 1e-8)
  })

  it('keeps orbit, pan and zoom finite and feeds the same camera into picking', () => {
    const input = {
      items: [
        [0, 0],
        [10, 0],
        [0, 10],
        [10, 10],
      ].map(([x, y], index) => ({
        facet: 'terrain',
        id: `terrain:${index}`,
        layerId: 'terrain',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: x / 10,
        y: y / 10,
        heightBase: 0,
        heightAdjustment: 0,
        mask: 0,
        uvwPosition: { x, y: 0, z: y },
      })),
    }
    const orbit = orbitWorldWebGlCamera(DEFAULT_WORLD_WEBGL_CAMERA, { x: 20, y: -10 })
    const zoom = zoomWorldWebGlCamera(orbit, -120)
    const pan = panWorldWebGlCamera(input, zoom, { x: 12, y: -7, viewportHeight: 480 })
    const frame = createWorldWebGlCameraFrame(createWorldWebGlPlan(input), 720, 480, pan)
    assert.equal(frame.viewProjection.length, 16)
    assert.equal(frame.viewMatrix.length, 16)
    assert.ok(frame.viewProjection.every(Number.isFinite))
    assert.ok(frame.eyePosition.every(Number.isFinite))
    assert.throws(
      () => createWorldWebGlCameraFrame(createWorldWebGlPlan(input), 0, 480, pan),
      /viewport/u,
    )
    assert.notEqual(pan.azimuth, DEFAULT_WORLD_WEBGL_CAMERA.azimuth)
    assert.ok(pan.zoom > 1)
    assert.notDeepEqual(pan.target, [0, 0, 0])
    assert.ok(
      pickWorldWebGl({ ...input, camera: pan }, { x: 360, y: 240, width: 720, height: 480 })
        ?.kind === 'terrain',
    )
  })
})
