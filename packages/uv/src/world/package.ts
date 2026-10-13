/** Core-owned UVP map packaging and detached reopen: resources used by weights, ordered tiles,
 * rasters, water and authored models; excluded partial facets do not demand unused media.
 * Admitted world node/sample budgets survive resource binding and detached source creation. */
import { canonicalJsonStringify, compareUtf8, ModkitError } from '@modkit/core'
import { createZipArchive, type ZipWriteBudget } from '@modkit/codec-kit/container/zip'
import { sha256Hex } from '@modkit/codec-kit/crypto/digest'
import { encodePng } from '@modkit/codec-kit/raster'
import type { RasterResourcePort, SceneRendererTexture } from '@modkit/sdk'
import {
  worldModelRequiredBytes,
  type CandidateWorldSceneSource,
  type MapModelComponentPlacement,
  type MapTerrainMaterialDefinition,
  type MapWaterMaterialDefinition,
  type WorldSceneObjectItem,
  type WorldSceneLayerItem,
} from '@modkit/sdk/maps'
import { readUvmContainer, uvmImageLogicalId, writeUvmContainer } from '../model/container.js'

import {
  DEFAULT_UVW_PARSE_LIMITS,
  canonicalizeUvwProfile,
  parseUvwProfile,
  serializeUvwProfile,
  type UvwHeightfieldSpaceLayer,
  type UvwObjectsLayer,
  type UvwProfileDocument,
  type UvwParseLimits,
  type UvwResource,
  type UvwResourcesLayer,
  type UvwTerrainMaterial,
  type UvwTerrainMaterialsLayer,
  type UvwWaterLayer,
} from './index.js'
import { materializeWorldToUvw, type WorldUvwMaterializationOptions } from './materializer.js'
import { localId } from './reconstruct.js'
import { createUvwWorldSceneSource } from './source.js'

const MANIFEST_PATH = 'uvp.manifest.json'
const WORLD_PATH = 'world/main.uvw.json'
const PACKAGE_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\/[a-z0-9][a-z0-9-]*$/u
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const SHA256 = /^sha256:[0-9a-f]{64}$/u
const LOCAL_ID = /^[a-z][a-z0-9-]*$/u

export interface UvpMapManifestContent {
  readonly family: 'uvw' | 'uvm' | 'media'
  readonly path: string
  readonly hash: `sha256:${string}`
}

export interface UvpMapManifest {
  readonly uv: Readonly<{ readonly format: 'UVP'; readonly version: '1.0' }>
  readonly id: string
  readonly version: string
  readonly kind: 'map'
  readonly title?: string
  readonly contents: readonly UvpMapManifestContent[]
  readonly dependencies: readonly []
  readonly requires: Readonly<{
    readonly intrinsics: readonly []
    readonly capabilities: readonly ['read']
  }>
  readonly namespaces: readonly string[]
}

export interface WorldUvpMaterializationOptions extends WorldUvwMaterializationOptions {
  readonly packageId: string
  readonly packageVersion: string
  readonly title?: string
  /** Maximum decoded bytes requested for one texture. */
  readonly maxTextureBytes: number
  /** Maximum total encoded package media bytes. */
  readonly maxMediaBytes: number
  /** Maximum aggregate bytes of independently reopened UVM object models. */
  readonly maxModelBytes?: number
  /** Maximum bytes requested for one native model conversion. Defaults to 16 MiB. */
  readonly maxModelResourceBytes?: number
  readonly maxModels?: number
  readonly maxLayers?: number
}

export interface WorldUvpRefusal {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export type WorldUvpMaterializationResult =
  | Readonly<{
      readonly state: 'refused'
      readonly sourceSnapshotId: string
      readonly refusals: readonly WorldUvpRefusal[]
      readonly refusalCodes: readonly string[]
    }>
  | Readonly<{
      readonly state: 'materialized'
      readonly sourceSnapshotId: string
      readonly document: UvwProfileDocument
      readonly manifest: UvpMapManifest
      readonly manifestBytes: Uint8Array
      readonly entries: ReadonlyMap<string, Uint8Array>
      readonly artifactDigest: `sha256:${string}`
      readonly observedTerrainItems: number
      readonly packagedTextureCount: number
      readonly packagedModelCount: number
      readonly packagedMediaBytes: number
      readonly unpackagedModelResourceIds: readonly string[]
      readonly unpackagedWaterResourceIds: readonly string[]
      /** Images of packaged models that came without decoded texels: kept by their logical id. */
      readonly unpackagedModelTextureIds: readonly string[]
      readonly excludedFacetIds: readonly string[]
      /** The UVW's own receipt: objects it left out and item fields it does not carry. */
      readonly omittedObjects: number
      readonly lostFields: readonly { readonly path: string; readonly count: number }[]
      readonly refusalCodes: readonly []
      readonly refusals: readonly []
    }>

export interface OpenUvpMapBundleOptions {
  readonly snapshotId: string
  readonly rasterResources?: RasterResourcePort
  readonly maxManifestBytes?: number
  readonly maxWorldBytes?: number
  readonly maxMediaBytes?: number
  readonly maxModelBytes?: number
  readonly modelDecoder?: import('./source.js').UvwEmbeddedModelDecoder
}

export interface OpenedUvpMapBundle {
  readonly manifest: UvpMapManifest
  readonly document: UvwProfileDocument
  readonly source: ReturnType<typeof createUvwWorldSceneSource>
  readonly embeddedResources: ReadonlyMap<
    string,
    Readonly<{ readonly bytes: Uint8Array; readonly mediaType?: string }>
  >
}

function fail(code: string, message: string, path?: string): never {
  throw new ModkitError({
    code,
    message,
    ...(path === undefined ? {} : { context: Object.freeze({ path }) }),
  })
}

function validPositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function packagePath(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    // an encoded segment reads one way as a ZIP name and another as a URI (SPEC_UVP §2)
    /%[0-9A-Fa-f]{2}/u.test(value) ||
    value.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    fail('x3.uv/uvp-path-invalid', 'UVP paths must be confined forward-slash package paths', path)
  }
  return value
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('x3.uv/uvp-manifest-invalid', `unknown key ${key}`, path)
  }
  for (const key of required) {
    if (!(key in value)) fail('x3.uv/uvp-manifest-invalid', `missing key ${key}`, path)
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('x3.uv/uvp-manifest-invalid', 'expected an object', path)
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('x3.uv/uvp-manifest-invalid', 'expected an array', path)
  return value
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('x3.uv/uvp-manifest-invalid', 'expected a string', path)
  return value
}

function parseManifest(bytes: Uint8Array, maximum: number): UvpMapManifest {
  if (bytes.byteLength > maximum)
    fail('x3.uv/uvp-budget-exceeded', 'UVP manifest exceeds its byte budget', MANIFEST_PATH)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch (cause) {
    throw new ModkitError({
      code: 'x3.uv/uvp-manifest-invalid',
      message: 'UVP manifest is not valid UTF-8 JSON',
      cause,
    })
  }
  const root = record(value, '$')
  exactKeys(
    root,
    ['uv', 'id', 'version', 'kind', 'title', 'contents', 'dependencies', 'requires', 'namespaces'],
    ['uv', 'id', 'version', 'kind', 'contents', 'dependencies', 'requires', 'namespaces'],
    '$',
  )
  const uv = record(root['uv'], '$.uv')
  exactKeys(uv, ['format', 'version'], ['format', 'version'], '$.uv')
  if (uv['format'] !== 'UVP' || uv['version'] !== '1.0')
    fail('x3.uv/uvp-manifest-invalid', 'only UVP 1.0 is supported', '$.uv')
  const id = text(root['id'], '$.id')
  const version = text(root['version'], '$.version')
  if (!PACKAGE_ID.test(id)) fail('x3.uv/uvp-manifest-invalid', 'invalid package id', '$.id')
  if (!SEMVER.test(version))
    fail('x3.uv/uvp-manifest-invalid', 'invalid package version', '$.version')
  if (root['kind'] !== 'map')
    fail('x3.uv/uvp-manifest-invalid', 'world bundle must be a map package', '$.kind')
  const title = root['title'] === undefined ? undefined : text(root['title'], '$.title')
  if (title !== undefined && title.length > 200)
    fail('x3.uv/uvp-manifest-invalid', 'title exceeds 200 characters', '$.title')
  const contents = array(root['contents'], '$.contents').map(
    (entry, index): UvpMapManifestContent => {
      const item = record(entry, `$.contents[${String(index)}]`)
      exactKeys(
        item,
        ['family', 'path', 'hash'],
        ['family', 'path', 'hash'],
        `$.contents[${String(index)}]`,
      )
      if (item['family'] !== 'uvw' && item['family'] !== 'uvm' && item['family'] !== 'media')
        fail(
          'x3.uv/uvp-manifest-invalid',
          'map bundle admits only uvw, uvm and media contents',
          `$.contents[${String(index)}].family`,
        )
      const contentPath = packagePath(item['path'], `$.contents[${String(index)}].path`)
      const hash = text(item['hash'], `$.contents[${String(index)}].hash`)
      if (!SHA256.test(hash))
        fail(
          'x3.uv/uvp-manifest-invalid',
          'invalid content SHA-256',
          `$.contents[${String(index)}].hash`,
        )
      return Object.freeze({
        family: item['family'],
        path: contentPath,
        hash: hash as `sha256:${string}`,
      })
    },
  )
  if (contents.filter(item => item.family === 'uvw').length !== 1)
    fail(
      'x3.uv/uvp-manifest-invalid',
      'map package must contain exactly one UVW document',
      '$.contents',
    )
  if (new Set(contents.map(item => item.path)).size !== contents.length)
    fail('x3.uv/uvp-manifest-invalid', 'content paths must be unique', '$.contents')
  if (array(root['dependencies'], '$.dependencies').length !== 0)
    fail(
      'x3.uv/uvp-manifest-invalid',
      'portable map bundle cannot depend on external packages',
      '$.dependencies',
    )
  const requires = record(root['requires'], '$.requires')
  exactKeys(requires, ['intrinsics', 'capabilities'], ['intrinsics', 'capabilities'], '$.requires')
  if (array(requires['intrinsics'], '$.requires.intrinsics').length !== 0)
    fail(
      'x3.uv/uvp-manifest-invalid',
      'portable map bundle cannot require intrinsics',
      '$.requires.intrinsics',
    )
  const capabilities = array(requires['capabilities'], '$.requires.capabilities')
  if (capabilities.length !== 1 || capabilities[0] !== 'read')
    fail(
      'x3.uv/uvp-manifest-invalid',
      'portable map bundle requires read only',
      '$.requires.capabilities',
    )
  const namespaces = array(root['namespaces'], '$.namespaces').map((entry, index) => {
    const namespace = text(entry, `$.namespaces[${String(index)}]`)
    if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/u.test(namespace))
      fail('x3.uv/uvp-manifest-invalid', 'invalid namespace', `$.namespaces[${String(index)}]`)
    return namespace
  })
  return Object.freeze({
    uv: Object.freeze({ format: 'UVP', version: '1.0' }),
    id,
    version,
    kind: 'map',
    ...(title === undefined ? {} : { title }),
    contents: Object.freeze(contents),
    dependencies: Object.freeze([]) as readonly [],
    requires: Object.freeze({
      intrinsics: Object.freeze([]) as readonly [],
      capabilities: Object.freeze(['read']) as readonly ['read'],
    }),
    namespaces: Object.freeze(namespaces),
  })
}

function localLayerId(id: string): string {
  const index = id.lastIndexOf(':')
  const candidate = index < 0 ? id : id.slice(index + 1)
  if (LOCAL_ID.test(candidate)) return candidate
  const suffix = candidate
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `layer-${suffix.length === 0 ? 'unknown' : suffix}`
}

function worldResourceId(spaceId: string, resourceId: string): string {
  return `uvw-resource:${encodeURIComponent(spaceId)}/${encodeURIComponent(resourceId)}`
}

async function digest(bytes: Uint8Array): Promise<`sha256:${string}`> {
  return `sha256:${await sha256Hex(bytes)}`
}

/**
 * A decoded texture as package media: PNG, which the glTF form of UVW reads (SPEC_UVW_GLTF; the
 * TGA this wrote before was not a glTF image).
 */
async function encodeMedia(texture: SceneRendererTexture): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(texture.width) ||
    !Number.isSafeInteger(texture.height) ||
    texture.width <= 0 ||
    texture.height <= 0 ||
    !(texture.rgba instanceof Uint8Array) ||
    texture.rgba.byteLength !== texture.width * texture.height * 4
  ) {
    throw new TypeError(`texture ${texture.id} is not tightly packed RGBA8`)
  }
  return encodePng(texture.width, texture.height, texture.rgba)
}

async function drainLayerCatalog(
  source: CandidateWorldSceneSource,
  maximum: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<readonly WorldSceneLayerItem[]> {
  const items: WorldSceneLayerItem[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    signal?.throwIfAborted()
    const page = await source.page(
      {
        facet: 'layers',
        limit: Math.min(pageSize, maximum),
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    )
    if (
      page.snapshotId !== source.snapshotId ||
      page.facet !== 'layers' ||
      page.state !== 'available'
    )
      throw new TypeError('world layer catalog page has an invalid identity or state')
    for (const item of page.items) {
      if (item.facet !== 'layers')
        throw new TypeError('world layer catalog contains a non-layer item')
      items.push(item)
      if (items.length > maximum)
        throw new RangeError(`world layer catalog exceeds ${String(maximum)} items`)
    }
    if (
      page.nextCursor !== undefined &&
      (page.nextCursor === cursor || cursors.has(page.nextCursor))
    )
      throw new TypeError('world layer catalog repeats a cursor')
    if (page.nextCursor !== undefined) cursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return Object.freeze(items)
}

async function drainLayerItems(
  source: CandidateWorldSceneSource,
  facet: string,
  layerId: string,
  maximum: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<readonly WorldSceneObjectItem[]> {
  const items: WorldSceneObjectItem[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    signal?.throwIfAborted()
    const page = await source.page(
      {
        facet,
        layerId,
        lod: 'exact',
        limit: Math.min(pageSize, maximum),
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    )
    if (page.snapshotId !== source.snapshotId || page.facet !== facet || page.state !== 'available')
      throw new TypeError(`world ${facet} page has an invalid identity or state`)
    for (const item of page.items) {
      if (item.facet !== 'objects')
        throw new TypeError(`world ${facet} page contains an invalid item`)
      items.push(item)
      if (items.length > maximum)
        throw new RangeError(`world ${facet} layer exceeds ${String(maximum)} items`)
    }
    if (
      page.nextCursor !== undefined &&
      (page.nextCursor === cursor || cursors.has(page.nextCursor))
    )
      throw new TypeError(`world ${facet} layer repeats a cursor`)
    if (page.nextCursor !== undefined) cursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return Object.freeze(items)
}

interface PortableBinding {
  readonly outputSpaceId: string
  readonly outputLayerId: string
  readonly layerKind: 'terrain-materials' | 'water'
  readonly materialId: string
  readonly channel:
    | 'baseColorResourceId'
    | 'secondaryColorResourceId'
    | 'normalResourceId'
    | 'specularResourceId'
    | 'causticsResourceId'
  readonly sourceResourceId: string
  readonly localResourceId: string
  readonly mediaPath: string
  readonly bytes: Uint8Array
  readonly digest: `sha256:${string}`
}

interface PortableWeightRasterBinding {
  readonly outputSpaceId: string
  readonly outputLayerId: string
  readonly rasterIndex: number
  readonly sourceResourceId: string
  readonly localResourceId: string
  readonly mediaPath: string
  readonly bytes: Uint8Array
  readonly digest: `sha256:${string}`
}

interface PortableModelTexture {
  readonly localResourceId: string
  readonly mediaPath: string
  readonly bytes: Uint8Array
  readonly digest: `sha256:${string}`
}

interface PortableObjectModelBinding {
  readonly outputSpaceId: string
  readonly outputLayerId: string
  readonly instanceIndex: number
  readonly sourceResourceId: string
  readonly localResourceId: string
  readonly modelPath: string
  readonly bytes: Uint8Array
  readonly digest: `sha256:${string}`
  readonly textures: readonly PortableModelTexture[]
  readonly sourceComponents?: readonly MapModelComponentPlacement[]
}

function outputMaterialLayer(
  document: UvwProfileDocument,
  catalog: WorldSceneLayerItem,
): Readonly<{ spaceId: string; layer: UvwTerrainMaterialsLayer }> | undefined {
  const wantedSpace = catalog.spaceId
  const wantedLayer = catalog.localLayerId ?? localLayerId(catalog.layerId)
  const candidates = document.spaces.flatMap(space =>
    space.layers.flatMap(layer =>
      layer.kind === 'terrain-materials' &&
      (wantedSpace === undefined || space.id === wantedSpace) &&
      layer.id === wantedLayer
        ? [{ spaceId: space.id, layer }]
        : [],
    ),
  )
  if (candidates.length === 1) return candidates[0]
  const all = document.spaces.flatMap(space =>
    space.layers.flatMap(layer =>
      layer.kind === 'terrain-materials' ? [{ spaceId: space.id, layer }] : [],
    ),
  )
  return all.length === 1 ? all[0] : undefined
}

function outputObjectLayer(
  document: UvwProfileDocument,
  catalog: WorldSceneLayerItem,
): Readonly<{ spaceId: string; layer: UvwObjectsLayer }> | undefined {
  const wantedSpace = catalog.spaceId
  const wantedLayer = catalog.localLayerId ?? localLayerId(catalog.layerId)
  const candidates = document.spaces.flatMap(space =>
    space.layers.flatMap(layer =>
      layer.kind === 'objects' &&
      (wantedSpace === undefined || space.id === wantedSpace) &&
      layer.id === wantedLayer
        ? [{ spaceId: space.id, layer }]
        : [],
    ),
  )
  if (candidates.length === 1) return candidates[0]
  const all = document.spaces.flatMap(space =>
    space.layers.flatMap(layer => (layer.kind === 'objects' ? [{ spaceId: space.id, layer }] : [])),
  )
  return all.length === 1 ? all[0] : undefined
}

function outputWaterLayer(
  document: UvwProfileDocument,
  catalog: WorldSceneLayerItem,
): Readonly<{ spaceId: string; layer: UvwWaterLayer }> | undefined {
  const wantedSpace = catalog.spaceId
  const wantedLayer = catalog.localLayerId ?? localLayerId(catalog.layerId)
  const candidates = document.spaces.flatMap(space =>
    space.layers.flatMap(layer =>
      layer.kind === 'water' &&
      (wantedSpace === undefined || space.id === wantedSpace) &&
      layer.id === wantedLayer
        ? [{ spaceId: space.id, layer }]
        : [],
    ),
  )
  if (candidates.length === 1) return candidates[0]
  const all = document.spaces.flatMap(space =>
    space.layers.flatMap(layer => (layer.kind === 'water' ? [{ spaceId: space.id, layer }] : [])),
  )
  return all.length === 1 ? all[0] : undefined
}

function normalizedResourceName(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase()
}

/**
 * A converted model with its decoded textures as package media. An image that came without texels
 * (an effect name, a texture that did not decode) keeps its logical id and is named in `missing`,
 * so one texture does not cost the package the model.
 */
async function makePortableUvm(
  bytes: Uint8Array,
  textures: readonly SceneRendererTexture[],
  modelOrdinal: number,
  signal?: AbortSignal,
): Promise<
  Readonly<{
    readonly bytes: Uint8Array
    readonly textures: readonly PortableModelTexture[]
    readonly missing: readonly string[]
  }>
> {
  const budget = {
    maxInputBytes: Math.max(bytes.byteLength * 4, 1024 * 1024),
    maxJsonBytes: Math.max(bytes.byteLength * 2, 1024 * 1024),
    maxDepth: 128,
    maxNodes: 1_000_000,
  }
  const container = readUvmContainer(bytes, budget, signal)
  const images = container.document['images']
  const portableTextures = await Promise.all(
    [...textures]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(async (texture, textureOrdinal): Promise<PortableModelTexture> => {
        const encoded = await encodeMedia(texture)
        const localResourceId = `object-model-${String(modelOrdinal).padStart(4, '0')}-texture-${String(textureOrdinal).padStart(4, '0')}`
        const mediaPath = `media/models/${localResourceId}.png`
        return Object.freeze({
          localResourceId,
          mediaPath,
          bytes: encoded,
          digest: await digest(encoded),
        })
      }),
  )
  /** The logical id of every external image, for those that come without texels. */
  const externalImages = (Array.isArray(images) ? images : []).flatMap(candidate =>
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    typeof (candidate as Record<string, unknown>)['uri'] === 'string' &&
    !((candidate as Record<string, unknown>)['uri'] as string).startsWith('data:') &&
    (candidate as Record<string, unknown>)['bufferView'] === undefined
      ? [uvmImageLogicalId((candidate as Record<string, unknown>)['uri'] as string)]
      : [],
  )
  if (portableTextures.length === 0)
    return Object.freeze({
      bytes: bytes.slice(),
      textures: Object.freeze([]),
      missing: Object.freeze(externalImages),
    })
  if (!Array.isArray(images)) throw new TypeError('textured UVM has no image declarations')
  const textureByName = new Map(
    textures.map(texture => [normalizedResourceName(texture.id), texture]),
  )
  const portableByName = new Map(
    [...textures]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(
        (texture, index) => [normalizedResourceName(texture.id), portableTextures[index]!] as const,
      ),
  )
  const matched = new Set<string>()
  const missing: string[] = []
  const rewrittenImages = images.map((candidate, imageIndex) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
      throw new TypeError(`UVM image ${String(imageIndex)} is not an object`)
    const image = candidate as Record<string, unknown>
    if (
      image['bufferView'] !== undefined ||
      (typeof image['uri'] === 'string' && image['uri'].startsWith('data:'))
    )
      return image
    if (typeof image['uri'] !== 'string')
      throw new TypeError(`UVM image ${String(imageIndex)} has no portable payload or URI`)
    const key = normalizedResourceName(uvmImageLogicalId(image['uri']))
    const texture = textureByName.get(key)
    const portable = portableByName.get(key)
    if (texture === undefined || portable === undefined) {
      missing.push(uvmImageLogicalId(image['uri']))
      return image
    }
    matched.add(key)
    return { ...image, name: texture.id, uri: portable.mediaPath, mimeType: 'image/png' }
  })
  if ([...textureByName.keys()].some(key => !matched.has(key)))
    throw new TypeError('decoded model texture has no matching UVM image declaration')
  const rewritten = writeUvmContainer(
    { ...container, document: { ...container.document, images: rewrittenImages as never } },
    budget,
    signal,
  )
  return Object.freeze({
    bytes: rewritten,
    textures: Object.freeze(portableTextures),
    missing: Object.freeze(missing),
  })
}

function sourceChannel(
  material: MapTerrainMaterialDefinition,
  channel: 'baseColorResourceId' | 'normalResourceId' | 'specularResourceId',
): string | undefined {
  return material[channel]
}

function sourceWaterChannel(
  material: MapWaterMaterialDefinition,
  channel: 'baseColorResourceId' | 'secondaryColorResourceId' | 'causticsResourceId',
): string | undefined {
  return material[channel]
}

function rewriteDocument(
  document: UvwProfileDocument,
  bindings: readonly PortableBinding[],
  weightBindings: readonly PortableWeightRasterBinding[],
  limits: UvwParseLimits,
): UvwProfileDocument {
  const perSpace = new Map<string, (PortableBinding | PortableWeightRasterBinding)[]>()
  for (const binding of [...bindings, ...weightBindings]) {
    const list = perSpace.get(binding.outputSpaceId) ?? []
    list.push(binding)
    perSpace.set(binding.outputSpaceId, list)
  }
  const value: UvwProfileDocument = {
    ...document,
    spaces: document.spaces.map(space => {
      const spaceBindings = perSpace.get(space.id) ?? []
      if (spaceBindings.length === 0) return space
      const portableResources: UvwResource[] = [
        ...new Map(
          spaceBindings.map(binding => [
            binding.localResourceId,
            {
              id: binding.localResourceId,
              kind: 'media' as const,
              uri: binding.mediaPath,
              digest: binding.digest,
            },
          ]),
        ).values(),
      ]
      const sourcePrefix = `uvw-resource:${encodeURIComponent(space.id)}/`
      const replacedLocalResources = new Set(
        spaceBindings.flatMap(binding => {
          if (!binding.sourceResourceId.startsWith(sourcePrefix)) return []
          try {
            return [decodeURIComponent(binding.sourceResourceId.slice(sourcePrefix.length))]
          } catch {
            throw new TypeError(`source resource ${binding.sourceResourceId} has an invalid UVW id`)
          }
        }),
      )
      for (const binding of weightBindings.filter(binding => binding.outputSpaceId === space.id)) {
        const layer = space.layers.find(
          candidate =>
            candidate.kind === 'terrain-materials' && candidate.id === binding.outputLayerId,
        )
        if (layer?.kind === 'terrain-materials') {
          const previous = layer.weightRasters?.[binding.rasterIndex]?.resourceId
          if (previous !== undefined) replacedLocalResources.add(previous)
        }
      }
      const existingResourceLayer = space.layers.find(layer => layer.kind === 'resources')
      const layers = space.layers.map((layer): UvwHeightfieldSpaceLayer => {
        if (layer.kind === 'terrain-materials') {
          const layerBindings = bindings.filter(
            binding =>
              binding.layerKind === 'terrain-materials' &&
              binding.outputSpaceId === space.id &&
              binding.outputLayerId === layer.id,
          )
          const layerWeightBindings = weightBindings.filter(
            binding => binding.outputSpaceId === space.id && binding.outputLayerId === layer.id,
          )
          if (layerBindings.length === 0 && layerWeightBindings.length === 0) return layer
          return {
            ...layer,
            materials: layer.materials.map((material): UvwTerrainMaterial => {
              const updates = layerBindings.filter(binding => binding.materialId === material.id)
              return updates.reduce<UvwTerrainMaterial>(
                (current, update) => ({ ...current, [update.channel]: update.localResourceId }),
                material,
              )
            }),
            ...(layer.weightRasters === undefined
              ? {}
              : {
                  weightRasters: layer.weightRasters.map((raster, rasterIndex) => ({
                    ...raster,
                    resourceId:
                      layerWeightBindings.find(binding => binding.rasterIndex === rasterIndex)
                        ?.localResourceId ?? raster.resourceId,
                  })),
                }),
          }
        }
        if (layer.kind === 'water') {
          const layerBindings = bindings.filter(
            binding =>
              binding.layerKind === 'water' &&
              binding.outputSpaceId === space.id &&
              binding.outputLayerId === layer.id,
          )
          if (layerBindings.length === 0 || layer.materials === undefined) return layer
          return {
            ...layer,
            materials: layer.materials.map(material => {
              const updates = layerBindings.filter(binding => binding.materialId === material.id)
              return updates.reduce(
                (current, update) => ({ ...current, [update.channel]: update.localResourceId }),
                material,
              )
            }),
          }
        }
        if (layer.kind === 'resources' && layer === existingResourceLayer) {
          return {
            ...layer,
            resources: [
              ...layer.resources.filter(resource => !replacedLocalResources.has(resource.id)),
              ...portableResources,
            ],
          }
        }
        if (layer.kind === 'resources' && replacedLocalResources.size > 0)
          return {
            ...layer,
            resources: layer.resources.filter(resource => !replacedLocalResources.has(resource.id)),
          }
        return layer
      })
      if (existingResourceLayer === undefined) {
        let id = 'portable-media'
        let suffix = 2
        while (layers.some(layer => layer.id === id)) id = `portable-media-${String(suffix++)}`
        const resourceLayer: UvwResourcesLayer = {
          schemaVersion: 1,
          id,
          kind: 'resources',
          label: 'UVP embedded world media',
          resources: portableResources,
        }
        layers.push(resourceLayer)
      }
      return { ...space, layers }
    }),
  }
  return canonicalizeUvwProfile(value, limits)
}

function rewriteObjectModels(
  document: UvwProfileDocument,
  bindings: readonly PortableObjectModelBinding[],
  limits: UvwParseLimits,
): UvwProfileDocument {
  const bySpace = new Map<string, PortableObjectModelBinding[]>()
  for (const binding of bindings) {
    const list = bySpace.get(binding.outputSpaceId) ?? []
    list.push(binding)
    bySpace.set(binding.outputSpaceId, list)
  }
  return canonicalizeUvwProfile({
    ...document,
    spaces: document.spaces.map(space => {
      const spaceBindings = bySpace.get(space.id) ?? []
      if (spaceBindings.length === 0) return space
      const portableResources = new Map<string, UvwResource>()
      const sourcePrefix = `uvw-resource:${encodeURIComponent(space.id)}/`
      const replacedLocalResources = new Set(
        spaceBindings.flatMap(binding => {
          if (!binding.sourceResourceId.startsWith(sourcePrefix)) return []
          try {
            return [decodeURIComponent(binding.sourceResourceId.slice(sourcePrefix.length))]
          } catch {
            throw new TypeError(`source resource ${binding.sourceResourceId} has an invalid UVW id`)
          }
        }),
      )
      for (const binding of spaceBindings) {
        portableResources.set(binding.localResourceId, {
          id: binding.localResourceId,
          kind: 'uvm',
          uri: binding.modelPath,
          digest: binding.digest,
        })
        for (const texture of binding.textures) {
          portableResources.set(texture.localResourceId, {
            id: texture.localResourceId,
            kind: 'media',
            uri: texture.mediaPath,
            digest: texture.digest,
          })
        }
      }
      let foundResourceLayer = false
      const layers = space.layers.map((layer): UvwHeightfieldSpaceLayer => {
        if (layer.kind === 'objects') {
          const layerBindings = spaceBindings.filter(binding => binding.outputLayerId === layer.id)
          if (layerBindings.length === 0) return layer
          const perInstance = new Map<number, string[]>()
          const bindingsPerInstance = new Map<number, PortableObjectModelBinding[]>()
          for (const binding of layerBindings) {
            const ids = perInstance.get(binding.instanceIndex) ?? []
            ids.push(binding.localResourceId)
            perInstance.set(binding.instanceIndex, ids)
            const instanceBindings = bindingsPerInstance.get(binding.instanceIndex) ?? []
            instanceBindings.push(binding)
            bindingsPerInstance.set(binding.instanceIndex, instanceBindings)
          }
          return {
            ...layer,
            instances: layer.instances.map((instance, index) => {
              const instanceBindings = bindingsPerInstance.get(index) ?? []
              const sourceComponents = instanceBindings.find(
                binding => binding.sourceComponents !== undefined,
              )?.sourceComponents
              const componentResourceIds = new Map(
                instanceBindings.map(binding => [
                  binding.sourceResourceId,
                  binding.localResourceId,
                ]),
              )
              let modelComponents = sourceComponents?.flatMap(component => {
                const resourceId = componentResourceIds.get(component.resourceId)
                return resourceId === undefined ? [] : [Object.freeze({ ...component, resourceId })]
              })
              if (modelComponents !== undefined) {
                let retained = new Set(modelComponents.map(component => component.id))
                while (
                  modelComponents.some(
                    component =>
                      component.parentId !== undefined && !retained.has(component.parentId),
                  )
                ) {
                  modelComponents = modelComponents.filter(
                    component =>
                      component.parentId === undefined || retained.has(component.parentId),
                  )
                  retained = new Set(modelComponents.map(component => component.id))
                }
              }
              return {
                ...instance,
                resourceIds: Object.freeze([
                  ...instance.resourceIds.filter(id => !replacedLocalResources.has(id)),
                  ...(perInstance.get(index) ?? []),
                ]),
                ...(modelComponents === undefined || modelComponents.length === 0
                  ? {}
                  : { modelComponents: Object.freeze(modelComponents) }),
              }
            }),
          }
        }
        if (layer.kind === 'resources' && !foundResourceLayer) {
          foundResourceLayer = true
          return {
            ...layer,
            resources: Object.freeze([
              ...layer.resources.filter(resource => !replacedLocalResources.has(resource.id)),
              ...portableResources.values(),
            ]),
          }
        }
        return layer
      })
      if (!foundResourceLayer) {
        let id = 'portable-models'
        let suffix = 2
        while (layers.some(layer => layer.id === id)) id = `portable-models-${String(suffix++)}`
        layers.push({
          schemaVersion: 1,
          id,
          kind: 'resources',
          label: 'UVP embedded object models',
          resources: Object.freeze([...portableResources.values()]),
        })
      }
      return { ...space, layers }
    }),
  }, limits)
}

export async function materializeWorldToUvpMap(
  source: CandidateWorldSceneSource,
  options: WorldUvpMaterializationOptions,
): Promise<WorldUvpMaterializationResult> {
  const refuse = (code: string, message: string, path?: string): WorldUvpMaterializationResult => {
    const item = Object.freeze({ code, message, ...(path === undefined ? {} : { path }) })
    return Object.freeze({
      state: 'refused' as const,
      sourceSnapshotId: source.snapshotId,
      refusals: Object.freeze([item]),
      refusalCodes: Object.freeze([code]),
    })
  }
  if (
    !PACKAGE_ID.test(options.packageId) ||
    !SEMVER.test(options.packageVersion) ||
    !validPositive(options.maxTextureBytes) ||
    !validPositive(options.maxMediaBytes) ||
    (options.maxLayers !== undefined && !validPositive(options.maxLayers)) ||
    (options.title !== undefined && options.title.length > 200)
  ) {
    return refuse(
      'invalid-package-options',
      'UVP package identity, title or budgets are invalid',
      'options',
    )
  }
  const materialized = await materializeWorldToUvw(source, options)
  if (materialized.state === 'refused') return materialized
  try {
    const layerCatalog = await drainLayerCatalog(
      source,
      options.maxLayers ?? 1024,
      options.maxPageItems,
      options.signal,
    )
    const catalogs = layerCatalog.filter(
      layer => layer.kind === 'terrain-materials' && layer.materials !== undefined,
    )
    const bindings: PortableBinding[] = []
    const weightBindings: PortableWeightRasterBinding[] = []
    const unpackagedWaterResourceIds = new Set<string>()
    const encodedBySource = new Map<
      string,
      Readonly<{
        bytes: Uint8Array
        digest: `sha256:${string}`
        localResourceId: string
        mediaPath: string
      }>
    >()
    let encodedTotal = 0
    let ordinal = 0
    for (const catalog of catalogs) {
      const target = outputMaterialLayer(materialized.document, catalog)
      // A visual catalog may accompany a deliberately excluded partial geometry/material facet.
      if (target === undefined && materialized.excludedFacetIds.includes('world.terrain-materials'))
        continue
      if (target === undefined)
        throw new TypeError(
          `cannot join terrain material catalog ${catalog.layerId} to materialized UVW`,
        )
      const usedMaterialIds = new Set([
        ...(target.layer.samples ?? []).flatMap(row =>
          row.flatMap(sample => [
            ...(sample.weights ?? []).map(weight => weight.materialId),
            ...(sample.layers ?? []).map(layer => layer.materialId),
          ]),
        ),
        ...(target.layer.weightRasters ?? []).flatMap(raster => raster.materialIds),
      ])
      for (const material of catalog.materials ?? []) {
        if (!usedMaterialIds.has(localId(material.materialId, 'material'))) continue
        if (
          !target.layer.materials.some(
            candidate => candidate.id === localId(material.materialId, 'material'),
          )
        )
          throw new TypeError(
            `material ${material.materialId} is absent from output layer ${target.layer.id}`,
          )
        for (const channel of [
          'baseColorResourceId',
          'normalResourceId',
          'specularResourceId',
        ] as const) {
          const resourceId = sourceChannel(material, channel)
          if (resourceId === undefined) continue
          let encoded = encodedBySource.get(resourceId)
          if (encoded === undefined) {
            if (source.texture === undefined)
              return refuse(
                'texture-route-missing',
                'world source does not expose terrain texture acquisition',
              )
            const result = await source.texture(
              resourceId,
              { maxBytes: options.maxTextureBytes },
              options.signal,
            )
            if (result.state !== 'decoded')
              throw new TypeError(
                `terrain texture ${resourceId} could not be decoded for portable packaging`,
              )
            const bytes = await encodeMedia(result.texture)
            encodedTotal += bytes.byteLength
            if (encodedTotal > options.maxMediaBytes)
              throw new RangeError(
                `encoded terrain media exceeds maxMediaBytes ${String(options.maxMediaBytes)}`,
              )
            const localResourceId = `terrain-media-${String(ordinal).padStart(4, '0')}`
            const mediaPath = `media/terrain/${localResourceId}.png`
            ordinal += 1
            encoded = Object.freeze({
              bytes,
              digest: await digest(bytes),
              localResourceId,
              mediaPath,
            })
            encodedBySource.set(resourceId, encoded)
          }
          bindings.push(
            Object.freeze({
              outputSpaceId: target.spaceId,
              outputLayerId: target.layer.id,
              layerKind: 'terrain-materials',
              materialId: localId(material.materialId, 'material'),
              channel,
              sourceResourceId: resourceId,
              localResourceId: encoded.localResourceId,
              mediaPath: encoded.mediaPath,
              bytes: encoded.bytes,
              digest: encoded.digest,
            }),
          )
        }
      }
      for (const [rasterIndex, raster] of (catalog.weightRasters ?? []).entries()) {
        const targetRaster = target.layer.weightRasters?.[rasterIndex]
        if (
          targetRaster === undefined ||
          targetRaster.width !== raster.width ||
          targetRaster.height !== raster.height ||
          // the UVW names a source material by its local id (`detail:newgrass.tga` → `material-newgrass-tga`)
          targetRaster.materialIds.join('\0') !==
            raster.materialIds.map(materialId => localId(materialId, 'material')).join('\0')
        )
          throw new TypeError(
            `terrain weight raster ${String(rasterIndex)} does not match output layer ${target.layer.id}`,
          )
        let encoded = encodedBySource.get(raster.resourceId)
        if (encoded === undefined) {
          if (source.texture === undefined)
            return refuse(
              'texture-route-missing',
              'world source does not expose terrain texture acquisition',
            )
          const result = await source.texture(
            raster.resourceId,
            { maxBytes: options.maxTextureBytes },
            options.signal,
          )
          if (result.state !== 'decoded')
            throw new TypeError(
              `terrain weight raster ${raster.resourceId} could not be decoded for portable packaging`,
            )
          if (result.texture.width !== raster.width || result.texture.height !== raster.height)
            throw new TypeError(
              `terrain weight raster ${raster.resourceId} decoded with unexpected dimensions`,
            )
          const bytes = await encodeMedia(result.texture)
          encodedTotal += bytes.byteLength
          if (encodedTotal > options.maxMediaBytes)
            throw new RangeError(
              `encoded terrain media exceeds maxMediaBytes ${String(options.maxMediaBytes)}`,
            )
          const localResourceId = `terrain-media-${String(ordinal).padStart(4, '0')}`
          const mediaPath = `media/terrain/${localResourceId}.png`
          ordinal += 1
          encoded = Object.freeze({
            bytes,
            digest: await digest(bytes),
            localResourceId,
            mediaPath,
          })
          encodedBySource.set(raster.resourceId, encoded)
        }
        weightBindings.push(
          Object.freeze({
            outputSpaceId: target.spaceId,
            outputLayerId: target.layer.id,
            rasterIndex,
            sourceResourceId: raster.resourceId,
            localResourceId: encoded.localResourceId,
            mediaPath: encoded.mediaPath,
            bytes: encoded.bytes,
            digest: encoded.digest,
          }),
        )
      }
    }
    for (const catalog of layerCatalog.filter(
      layer => layer.kind === 'water' && layer.waterMaterials !== undefined,
    )) {
      const target = outputWaterLayer(materialized.document, catalog)
      // A publisher may expose a visual catalog while correctly withholding a non-exact water
      // geometry layer. In that case there is no portable reference to package.
      if (target === undefined) continue
      const usedMaterialIds = new Set(
        target.layer.zones.flatMap(zone =>
          zone.materialId === undefined ? [] : [zone.materialId],
        ),
      )
      for (const material of catalog.waterMaterials ?? []) {
        if (!usedMaterialIds.has(material.materialId)) continue
        if (!target.layer.materials?.some(candidate => candidate.id === material.materialId))
          throw new TypeError(
            `water material ${material.materialId} is absent from output layer ${target.layer.id}`,
          )
        for (const channel of [
          'baseColorResourceId',
          'secondaryColorResourceId',
          'causticsResourceId',
        ] as const) {
          const resourceId = sourceWaterChannel(material, channel)
          if (resourceId === undefined) continue
          let encoded = encodedBySource.get(resourceId)
          if (encoded === undefined) {
            if (source.texture === undefined)
              return refuse(
                'texture-route-missing',
                'world source does not expose terrain texture acquisition',
              )
            const result = await source.texture(
              resourceId,
              { maxBytes: options.maxTextureBytes },
              options.signal,
            )
            if (result.state !== 'decoded') {
              unpackagedWaterResourceIds.add(resourceId)
              continue
            }
            const bytes = await encodeMedia(result.texture)
            encodedTotal += bytes.byteLength
            if (encodedTotal > options.maxMediaBytes)
              throw new RangeError(
                `encoded world media exceeds maxMediaBytes ${String(options.maxMediaBytes)}`,
              )
            const localResourceId = `water-media-${String(ordinal).padStart(4, '0')}`
            const mediaPath = `media/water/${localResourceId}.png`
            ordinal += 1
            encoded = Object.freeze({
              bytes,
              digest: await digest(bytes),
              localResourceId,
              mediaPath,
            })
            encodedBySource.set(resourceId, encoded)
          }
          bindings.push(
            Object.freeze({
              outputSpaceId: target.spaceId,
              outputLayerId: target.layer.id,
              layerKind: 'water',
              materialId: material.materialId,
              channel,
              sourceResourceId: resourceId,
              localResourceId: encoded.localResourceId,
              mediaPath: encoded.mediaPath,
              bytes: encoded.bytes,
              digest: encoded.digest,
            }),
          )
        }
      }
    }
    const objectBindings: PortableObjectModelBinding[] = []
    const unpackagedModelResourceIds = new Set<string>()
    const unpackagedModelTextureIds = new Set<string>()
    const modelBySource = new Map<
      string,
      Omit<
        PortableObjectModelBinding,
        'outputSpaceId' | 'outputLayerId' | 'instanceIndex' | 'sourceResourceId'
      >
    >()
    const maxModels = options.maxModels ?? 256
    const maxModelBytes = options.maxModelBytes ?? 256 * 1024 * 1024
    const maxModelResourceBytes =
      options.maxModelResourceBytes ?? Math.min(maxModelBytes, 16 * 1024 * 1024)
    if (
      !validPositive(maxModels) ||
      !validPositive(maxModelBytes) ||
      !validPositive(maxModelResourceBytes)
    )
      throw new TypeError('model package budgets are invalid')
    let modelTotal = 0
    for (const catalog of layerCatalog.filter(layer => layer.kind === 'objects')) {
      const target = outputObjectLayer(materialized.document, catalog)
      if (target === undefined && materialized.excludedFacetIds.includes('world.objects')) continue
      if (target === undefined)
        throw new TypeError(`cannot join object catalog ${catalog.layerId} to materialized UVW`)
      const objects = await drainLayerItems(
        source,
        'objects',
        catalog.layerId,
        options.maxFacetItems ?? options.maxTerrainItems,
        options.maxPageItems,
        options.signal,
      )
      // Joined by the instance id the UVW gave each object, as the reconstruction names it: the
      // canonical UVW sorts instances, and an object it left out (a cliff piece, no canonical
      // place, a repeated id) has no instance to bind.
      const instanceIndexById = new Map(
        target.layer.instances.map((instance, index) => [instance.id, index] as const),
      )
      const bound = new Set<number>()
      for (const object of objects) {
        if (object.derivedFrom !== undefined) continue
        const instanceIndex = instanceIndexById.get(localId(object.id, 'instance'))
        if (instanceIndex === undefined || bound.has(instanceIndex)) continue
        bound.add(instanceIndex)
        const sourceIds =
          object.resourceIds ?? (object.resourceId === undefined ? [] : [object.resourceId])
        for (const sourceResourceId of sourceIds) {
          let portable = modelBySource.get(sourceResourceId)
          if (portable === undefined) {
            if (modelBySource.size >= maxModels)
              throw new RangeError(`object models exceed maxModels ${String(maxModels)}`)
            if (source.model === undefined) {
              unpackagedModelResourceIds.add(sourceResourceId)
              continue
            }
            const remaining = maxModelBytes - modelTotal
            if (remaining <= 0) throw new RangeError('object models exceed maxModelBytes')
            // The model's textures share its `maxBytes` with its UVM, within what media is left.
            const textureBytes = Math.max(
              1,
              Math.min(maxModelResourceBytes, options.maxMediaBytes - encodedTotal),
            )
            const ask = (maxBytes: number, textureTotal: number) =>
              source.model!(
                sourceResourceId,
                {
                  maxBytes,
                  maxNodes: Math.min(options.maxPageItems, 1_024),
                  maxMeshes: Math.min(options.maxPageItems, 1_024),
                  maxPrimitives: Math.min(options.maxPageItems, 1_024),
                  maxPrimitiveBytes: maxBytes,
                  maxResources: Math.min(options.maxPageItems, 1_024),
                  maxTextureBytes: Math.min(options.maxTextureBytes, textureTotal),
                  maxTextureTotalBytes: textureTotal,
                },
                options.signal,
              )
            const modelRequestBytes = Math.min(remaining, maxModelResourceBytes)
            // The first ask leaves the UVM a quarter: a texture asked for all of maxBytes refuses
            // beside any UVM, and the host keeps that refusal for the same budget.
            let result = await ask(
              modelRequestBytes,
              Math.max(1, Math.min(textureBytes, Math.floor((modelRequestBytes * 3) / 4))),
            )
            // A model that names what it needed is asked once more, as the world viewer does. Its
            // UVM stays reserved while its textures decode, so they get what the UVM leaves.
            const required =
              result.state === 'converted' && result.complete && result.uvmBytes !== undefined
                ? undefined
                : worldModelRequiredBytes(result)
            const retryBytes =
              required === undefined ? undefined : Math.min(remaining, required + textureBytes)
            if (required !== undefined && retryBytes !== undefined && retryBytes > required)
              result = await ask(retryBytes, retryBytes - required)
            if (result.state !== 'converted' || !result.complete || result.uvmBytes === undefined) {
              unpackagedModelResourceIds.add(sourceResourceId)
              continue
            }
            const modelOrdinal = modelBySource.size
            const converted = await makePortableUvm(
              result.uvmBytes,
              result.textures ?? [],
              modelOrdinal,
              options.signal,
            )
            for (const id of converted.missing) unpackagedModelTextureIds.add(id)
            for (const texture of converted.textures) encodedTotal += texture.bytes.byteLength
            if (encodedTotal > options.maxMediaBytes)
              throw new RangeError(
                `encoded package media exceeds maxMediaBytes ${String(options.maxMediaBytes)}`,
              )
            modelTotal += converted.bytes.byteLength
            if (modelTotal > maxModelBytes)
              throw new RangeError(`object models exceed maxModelBytes ${String(maxModelBytes)}`)
            const localResourceId = `object-model-${String(modelOrdinal).padStart(4, '0')}`
            const modelPath = `models/${localResourceId}.uvm.glb`
            portable = Object.freeze({
              localResourceId,
              modelPath,
              bytes: converted.bytes,
              digest: await digest(converted.bytes),
              textures: converted.textures,
            })
            modelBySource.set(sourceResourceId, portable)
          }
          objectBindings.push(
            Object.freeze({
              outputSpaceId: target.spaceId,
              outputLayerId: target.layer.id,
              instanceIndex,
              sourceResourceId,
              ...(object.modelComponents === undefined
                ? {}
                : { sourceComponents: object.modelComponents }),
              ...portable,
            }),
          )
        }
      }
      if (bound.size !== target.layer.instances.length)
        throw new TypeError(`object layer ${catalog.layerId} changed during UVP materialization`)
    }
    // Retain the materializer's admitted limits while binding media and models.
    const worldLimits = {
      maxNodes: Math.max(DEFAULT_UVW_PARSE_LIMITS.maxNodes, options.maxOutputBytes),
      maxSamples: Math.max(options.maxTerrainItems + (options.maxFacetItems ?? options.maxTerrainItems),
        DEFAULT_UVW_PARSE_LIMITS.maxSamples),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }
    let document = rewriteDocument(materialized.document, bindings, weightBindings, worldLimits)
    document = rewriteObjectModels(document, objectBindings, worldLimits)
    const worldBytes = serializeUvwProfile(document, {
      ...worldLimits,
      maxBytes: options.maxOutputBytes,
    })
    const uniqueMedia = new Map<
      string,
      Readonly<{ mediaPath: string; bytes: Uint8Array; digest: `sha256:${string}` }>
    >()
    for (const binding of bindings) uniqueMedia.set(binding.mediaPath, binding)
    for (const binding of weightBindings) uniqueMedia.set(binding.mediaPath, binding)
    for (const model of modelBySource.values())
      for (const texture of model.textures) uniqueMedia.set(texture.mediaPath, texture)
    const uniqueModels = new Map([...modelBySource.values()].map(model => [model.modelPath, model]))
    const contents: UvpMapManifestContent[] = [
      Object.freeze({ family: 'uvw', path: WORLD_PATH, hash: await digest(worldBytes) }),
      ...[...uniqueModels.values()]
        .sort((left, right) => left.modelPath.localeCompare(right.modelPath))
        .map(model =>
          Object.freeze({
            family: 'uvm' as const,
            path: model.modelPath,
            hash: model.digest,
          }),
        ),
      ...[...uniqueMedia.values()]
        .sort((left, right) => left.mediaPath.localeCompare(right.mediaPath))
        .map(binding =>
          Object.freeze({
            family: 'media' as const,
            path: binding.mediaPath,
            hash: binding.digest,
          }),
        ),
    ]
    const namespace = options.packageId.slice(0, options.packageId.indexOf('/'))
    const manifest: UvpMapManifest = Object.freeze({
      uv: Object.freeze({ format: 'UVP', version: '1.0' }),
      id: options.packageId,
      version: options.packageVersion,
      kind: 'map',
      ...(options.title === undefined ? {} : { title: options.title }),
      contents: Object.freeze(contents),
      dependencies: Object.freeze([]) as readonly [],
      requires: Object.freeze({
        intrinsics: Object.freeze([]) as readonly [],
        capabilities: Object.freeze(['read']) as readonly ['read'],
      }),
      namespaces: Object.freeze([namespace]),
    })
    const manifestBytes = new TextEncoder().encode(`${canonicalJsonStringify(manifest)}\n`)
    const entries = new Map<string, Uint8Array>([
      [MANIFEST_PATH, manifestBytes.slice()],
      [WORLD_PATH, worldBytes.slice()],
    ])
    for (const model of uniqueModels.values()) entries.set(model.modelPath, model.bytes.slice())
    for (const binding of uniqueMedia.values())
      entries.set(binding.mediaPath, binding.bytes.slice())
    return Object.freeze({
      state: 'materialized' as const,
      sourceSnapshotId: source.snapshotId,
      document,
      manifest,
      manifestBytes,
      entries,
      artifactDigest: await digest(manifestBytes),
      observedTerrainItems: materialized.observedTerrainItems,
      packagedTextureCount: uniqueMedia.size,
      packagedModelCount: uniqueModels.size,
      packagedMediaBytes: encodedTotal,
      unpackagedModelResourceIds: Object.freeze([...unpackagedModelResourceIds].sort()),
      unpackagedWaterResourceIds: Object.freeze([...unpackagedWaterResourceIds].sort()),
      unpackagedModelTextureIds: Object.freeze([...unpackagedModelTextureIds].sort()),
      excludedFacetIds: Object.freeze([
        ...materialized.excludedFacetIds,
        ...(unpackagedModelResourceIds.size === 0 && unpackagedModelTextureIds.size === 0
          ? []
          : ['world.object-model-resources']),
        ...(unpackagedWaterResourceIds.size === 0 ? [] : ['world.water-material-resources']),
      ]),
      omittedObjects: materialized.omittedObjects,
      lostFields: materialized.lostFields,
      refusalCodes: Object.freeze([]) as readonly [],
      refusals: Object.freeze([]) as readonly [],
    })
  } catch (error) {
    if (options.signal?.aborted === true)
      return refuse('cancelled', 'UVP materialization was cancelled')
    return refuse(
      error instanceof RangeError ? 'media-budget-exceeded' : 'media-materialization-failed',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * The single-file UVP (SPEC_UVP §2): a ZIP of uvp.manifest.json and the manifest's content paths,
 * stored, without a wrapper directory, written by the archive codec's own writer (codec-kit
 * container/zip). The manifest comes first and the contents in path order, so the same package
 * writes the same bytes; neither order nor timestamps enter its identity.
 */
export function packUvpArchive(
  entries: ReadonlyMap<string, Uint8Array>,
  budget: ZipWriteBudget,
): Uint8Array {
  const manifest = entries.get(MANIFEST_PATH)
  if (manifest === undefined)
    fail('x3.uv/uvp-entry-missing', `UVP bundle is missing ${MANIFEST_PATH}`)
  const contents = [...entries.keys()]
    .filter(path => path !== MANIFEST_PATH)
    .sort(compareUtf8)
    .map(path => [packagePath(path, 'entries'), entries.get(path)!] as const)
  return createZipArchive([[MANIFEST_PATH, manifest], ...contents], budget)
}

export async function openUvpMapBundle(
  entries: ReadonlyMap<string, Uint8Array>,
  options: OpenUvpMapBundleOptions,
): Promise<OpenedUvpMapBundle> {
  const manifestBytes = entries.get(MANIFEST_PATH)
  if (manifestBytes === undefined)
    fail('x3.uv/uvp-entry-missing', `UVP bundle is missing ${MANIFEST_PATH}`)
  const manifest = parseManifest(manifestBytes, options.maxManifestBytes ?? 1024 * 1024)
  const declared = new Set(manifest.contents.map(content => content.path))
  // names that differ only by Unicode form or case collide on most file systems (SPEC_UVP §2)
  const folded = new Map<string, string>()
  for (const path of entries.keys()) {
    packagePath(path, 'entries')
    const key = path.normalize('NFC').toUpperCase().toLowerCase()
    const prior = folded.get(key)
    if (prior !== undefined)
      fail('x3.uv/uvp-path-collision', `UVP entries ${prior} and ${path} collide`, path)
    folded.set(key, path)
    if (path !== MANIFEST_PATH && !declared.has(path))
      fail('x3.uv/uvp-entry-undeclared', `UVP bundle contains undeclared entry ${path}`)
  }
  for (const content of manifest.contents) {
    const bytes = entries.get(content.path)
    if (bytes === undefined)
      fail('x3.uv/uvp-entry-missing', `UVP bundle is missing ${content.path}`)
    if ((await digest(bytes)) !== content.hash)
      fail('x3.uv/uvp-hash-mismatch', `UVP content hash mismatch for ${content.path}`)
  }
  const worldContent = manifest.contents.find(content => content.family === 'uvw')!
  const worldBytes = entries.get(worldContent.path)!
  if (worldBytes.byteLength > (options.maxWorldBytes ?? 64 * 1024 * 1024))
    fail('x3.uv/uvp-budget-exceeded', 'UVW document exceeds its byte budget', worldContent.path)
  const worldLimits = {
    maxBytes: options.maxWorldBytes ?? 64 * 1024 * 1024,
    maxNodes: Math.max(DEFAULT_UVW_PARSE_LIMITS.maxNodes, options.maxWorldBytes ?? 64 * 1024 * 1024),
  }
  const document = parseUvwProfile(worldBytes, worldLimits)
  const packagedResources = new Map(
    manifest.contents
      .filter(content => content.family === 'media' || content.family === 'uvm')
      .map(content => [content.path, content]),
  )
  let mediaBytes = 0
  let modelBytes = 0
  const chargedPaths = new Set<string>()
  const referencedPaths = new Set<string>()
  const embedded = new Map<
    string,
    Readonly<{ readonly bytes: Uint8Array; readonly mediaType?: string }>
  >()
  for (const space of document.spaces) {
    for (const layer of space.layers) {
      if (layer.kind !== 'resources') continue
      for (const resource of layer.resources) {
        const content = packagedResources.get(resource.uri)
        if (content === undefined)
          fail(
            'x3.uv/uvp-resource-undeclared',
            `UVW resource ${resource.id} is not declared by UVP`,
          )
        if (content.family !== resource.kind)
          fail(
            'x3.uv/uvp-resource-family-mismatch',
            `UVW resource ${resource.id} has the wrong UVP family`,
          )
        const bytes = entries.get(content.path)!
        if (resource.digest !== content.hash)
          fail('x3.uv/uvp-hash-mismatch', `UVW and UVP digests disagree for ${content.path}`)
        referencedPaths.add(content.path)
        if (!chargedPaths.has(content.path)) {
          chargedPaths.add(content.path)
          if (content.family === 'media') {
            mediaBytes += bytes.byteLength
            if (mediaBytes > (options.maxMediaBytes ?? 256 * 1024 * 1024))
              fail('x3.uv/uvp-budget-exceeded', 'UVP media exceeds its byte budget', content.path)
          } else {
            modelBytes += bytes.byteLength
            if (modelBytes > (options.maxModelBytes ?? 256 * 1024 * 1024))
              fail('x3.uv/uvp-budget-exceeded', 'UVP models exceed their byte budget', content.path)
          }
        }
        embedded.set(
          worldResourceId(space.id, resource.id),
          Object.freeze({ bytes: bytes.slice() }),
        )
      }
    }
  }
  if (referencedPaths.size !== packagedResources.size)
    fail(
      'x3.uv/uvp-resource-unreferenced',
      'every declared UVP model/media entry must be referenced by UVW',
    )
  return Object.freeze({
    manifest,
    document,
    source: createUvwWorldSceneSource(document, {
      limits: worldLimits,
      snapshotId: options.snapshotId,
      mapId: manifest.id,
      embeddedResources: embedded,
      ...(options.rasterResources === undefined
        ? {}
        : { rasterResources: options.rasterResources }),
      ...(options.modelDecoder === undefined ? {} : { modelDecoder: options.modelDecoder }),
    }),
    embeddedResources: embedded,
  })
}
