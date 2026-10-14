/** Portable terrain-overlay authoring over already clipped, terrain-conforming triangles.
 * The world renderer owns clipping, UV interpolation and draw order. This adapter only writes
 * those triangles to ordinary UVM artifacts; it knows no game, map name or native model format.
 * Texture alpha and explicit per-vertex coverage multiply independently. Lighting normals are
 * derived from the admitted triangles; source normal/specular maps are outside this profile.
 */
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { writeUvmContainer, type UvmContainer } from '@modkit/uv/model/container'
import { generateUvmVertexNormals, uvmTriangleAreaVector } from '../uvm/normals.js'
import { transformUvmPrimitiveGeometry } from '../uvm/static-model.js'
import { IDENTITY_MATERIAL_FRAME, materialFrame } from '../materials/frame.js'

export interface TerrainOverlayModelInput {
  readonly positions: Float32Array
  readonly textureCoordinates: Float32Array
  readonly coverage: Float32Array
  readonly texturePath: string
  /** Coverage-only atlas layers ignore image alpha through the common material program.
   * Consumers using only the generic glTF fallback cannot preserve this policy. */
  readonly textureAlpha?: 'multiply' | 'ignore'
  readonly priority: number
}

export interface TerrainOverlayModelOptions {
  readonly assetId: string
  readonly frame?: readonly number[]
  readonly maxVerticesPerModel: number
  readonly maxScalarBytes: number
  readonly maxModels: number
  /** Float32 clipping may produce exactly zero-area fragments, which draw nothing. */
  readonly degenerateTriangles?: 'refuse' | 'omit-zero-area'
}

/** Materialize a selected ordered overlay batch without baking its texture into a map image.
 * Each chunk stays within the caller's target vertex limit and retains painter priority. */
export function materializeTerrainOverlayModels(
  input: TerrainOverlayModelInput,
  options: TerrainOverlayModelOptions,
  signal?: AbortSignal,
): Readonly<{ models: readonly UvmContainer[]; omittedTriangleIndices: readonly number[] }> {
  signal?.throwIfAborted()
  const vertices = input.positions.length / 3
  if (!Number.isSafeInteger(vertices) || vertices === 0 || vertices % 3 ||
      input.textureCoordinates.length !== vertices * 2 || input.coverage.length !== vertices)
    throw new TypeError('terrain overlay requires finite triangle positions, UVs and unit coverage')
  if (!Number.isSafeInteger(input.priority) ||
      (input.textureAlpha !== undefined && !['multiply', 'ignore'].includes(input.textureAlpha)) ||
      !input.texturePath || /^(?:[a-z]+:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)|\0/iu.test(input.texturePath) ||
      !options.assetId || !Number.isSafeInteger(options.maxVerticesPerModel) ||
      options.maxVerticesPerModel < 3 || !Number.isSafeInteger(options.maxModels) || options.maxModels < 1 ||
      !Number.isSafeInteger(options.maxScalarBytes) || options.maxScalarBytes < 1)
    throw new TypeError('invalid terrain overlay identity, priority or authoring budget')
  const chunkVertices = Math.floor(options.maxVerticesPerModel / 3) * 3
  if (Math.ceil(vertices / chunkVertices) > options.maxModels || vertices * 160 > options.maxScalarBytes)
    throw new RangeError('terrain overlay exceeds authoring budget')
  const frame = materialFrame(options.frame ?? IDENTITY_MATERIAL_FRAME)
  for (const values of [input.positions, input.textureCoordinates, input.coverage]) {
    for (let index = 0; index < values.length; index++) {
      if ((index & 0x3fff) === 0) signal?.throwIfAborted()
      const value = values[index]!
      if (!Number.isFinite(value) || (values === input.coverage && (value < 0 || value > 1)))
        throw new TypeError('terrain overlay requires finite triangle positions, UVs and unit coverage')
    }
  }
  if (options.degenerateTriangles !== undefined &&
      !['refuse', 'omit-zero-area'].includes(options.degenerateTriangles))
    throw new TypeError('unknown terrain overlay degenerate-triangle policy')
  const retained: number[] = [], omittedTriangleIndices: number[] = []
  for (let vertex = 0; vertex < vertices; vertex += 3) {
    if ((vertex & 0x3fff) === 0) signal?.throwIfAborted()
    const area = Math.hypot(...uvmTriangleAreaVector(input.positions, vertex, vertex + 1, vertex + 2))
    if (area === 0) {
      if (options.degenerateTriangles !== 'omit-zero-area')
        throw new TypeError('terrain overlay contains a zero-area triangle')
      omittedTriangleIndices.push(vertex / 3)
    } else retained.push(vertex, vertex + 1, vertex + 2)
  }
  const ownedPositions = new Float32Array(retained.length * 3)
  const ownedUv = new Float32Array(retained.length * 2)
  for (let index = 0; index < retained.length; index++) {
    if ((index & 0x3fff) === 0) signal?.throwIfAborted()
    const vertex = retained[index]!
    for (let component = 0; component < 3; component++)
      ownedPositions[index * 3 + component] = input.positions[vertex * 3 + component]!
    for (let component = 0; component < 2; component++)
      ownedUv[index * 2 + component] = input.textureCoordinates[vertex * 2 + component]!
  }
  const result: UvmContainer[] = []
  for (let start = 0; start < retained.length; start += chunkVertices) {
    signal?.throwIfAborted()
    const count = Math.min(chunkVertices, retained.length - start)
    const positions = ownedPositions.slice(start * 3, (start + count) * 3)
    const indices = Uint32Array.from({ length: count }, (_, index) => index)
    const normals = generateUvmVertexNormals(positions, indices, signal)
    const geometry = transformUvmPrimitiveGeometry({ positions, indices, normals },
      frame)
    const colors = new Float32Array(count * 4).fill(1)
    for (let vertex = 0; vertex < count; vertex++) {
      if ((vertex & 0x3fff) === 0) signal?.throwIfAborted()
      colors[vertex * 4 + 3] = input.coverage[retained[start + vertex]!]!
    }
    const diffuse = {
      // Coverage is carried by alpha1 and COLOR_0; diffuse contributes RGB only.
      slot: 'diffuse', texturePath: input.texturePath, uvSource: 0, channels: 0,
      op: 6, teamColorMode: 0, invert: false, clampResult: false, wrapX: true, wrapY: true,
    }
    const source: UvmContainer = {
      format: 'glb', binary: new Uint8Array(), extraChunks: [],
      document: {
        asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [],
        materials: [{ name: 'Terrain overlay', alphaMode: 'BLEND', doubleSided: true,
          pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1, baseColorTexture: { index: 0 } },
          extensions: { UV_game_material: { shader: 'modkit.render-material.v1', params: {
            renderModel: { version: 1, standard: {
              layers: { diffuse, alpha1: { ...diffuse, slot: 'alpha1', channels: 2,
                ...(input.textureAlpha === 'ignore' ? { texturePath: null, constantColor: { value: [1, 1, 1, 1] } } : {}),
              } },
              blendMode: 1, priority: input.priority, specularity: 0, specMult: 0, emisMult: 0,
              environmentMultipliers: [1, 0, 0], specMode: 0, alphaTestThreshold: 0,
              twoSided: true, unshaded: false, depthPrepass: false, doubleLambert: false,
              clampOutput: false, usesVertexColor: false, usesVertexAlpha: true,
            } },
          } } } }],
        images: [{ name: input.texturePath, uri: input.texturePath }], textures: [{ source: 0 }],
        extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_material'],
        extensions: {
          UV_asset: { id: `${options.assetId}-${result.length}`, class: 'terrain-overlay' },
          UV_provenance: { source: { format: 'uvw' }, importer: { id: 'modkit/terrain-overlay-model', version: '1' } },
        },
      },
    }
    const appended = appendUvmAccessors(source, [
      { type: 'VEC3', values: Float32Array.from(geometry.positions) },
      { type: 'VEC3', values: Float32Array.from(geometry.normals!) },
      { type: 'VEC2', values: ownedUv.slice(start * 2, (start + count) * 2) },
      { type: 'VEC4', values: colors }, { type: 'SCALAR', values: Uint32Array.from(geometry.indices) },
    ], { maxInputBytes: options.maxScalarBytes, maxJsonBytes: options.maxScalarBytes,
      maxDepth: 96, maxNodes: options.maxScalarBytes, maxScalarBytes: options.maxScalarBytes }, signal)
    const container: UvmContainer = { ...appended.container, document: {
      ...appended.container.document, meshes: [{ primitives: [{ mode: 4, material: 0,
        indices: appended.accessors[4]!, attributes: { POSITION: appended.accessors[0]!,
          NORMAL: appended.accessors[1]!, TEXCOORD_0: appended.accessors[2]!, COLOR_0: appended.accessors[3]! } }] }],
    } }
    writeUvmContainer(container, { maxInputBytes: options.maxScalarBytes, maxJsonBytes: options.maxScalarBytes,
      maxDepth: 96, maxNodes: options.maxScalarBytes }, signal)
    result.push(container)
  }
  return { models: result, omittedTriangleIndices }
}
