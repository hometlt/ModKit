import { ModkitError } from '@modkit/core'

/**
 * Draco geometry decoding through Google's official decoder (`draco3d`, WebAssembly).
 *
 * Users: Roblox meshes v6/v7 (`COREMESH` version 2 is a Draco stream) and glTF
 * `KHR_draco_mesh_compression`. The runtime loads lazily: Node imports the installed package; a
 * browser host calls `initializeDracoBrowser` with the folder holding `draco_decoder.js` and
 * `draco_decoder.wasm` first.
 */

export type DracoAttributeType =
  'position' | 'normal' | 'color' | 'texcoord' | 'generic' | 'invalid'

export type DracoDataType = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32'

export type DracoAttributeData =
  Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array

export interface DracoAttribute {
  readonly uniqueId: number
  readonly type: DracoAttributeType
  readonly componentCount: number
  readonly dataType: DracoDataType
  readonly normalized: boolean
  /** Point-major values in the attribute's own data type, dequantized by Draco. */
  readonly data: DracoAttributeData
}

export interface DracoGeometry {
  readonly kind: 'mesh' | 'point-cloud'
  readonly pointCount: number
  /** Triangle corner indices into the points; absent for point clouds. */
  readonly indices?: Uint32Array
  readonly attributes: readonly DracoAttribute[]
}

export interface DracoDecodeLimits {
  readonly maxPoints: number
  readonly maxFaces: number
}

const DEFAULT_LIMITS: DracoDecodeLimits = Object.freeze({
  maxPoints: 16_000_000,
  maxFaces: 32_000_000,
})

interface DracoStatus {
  ok(): boolean
  error_msg(): string
}

interface DracoAttributeHandle {
  num_components(): number
  data_type(): number
  normalized(): boolean
  attribute_type(): number
  unique_id(): number
}

interface DracoGeometryHandle {
  num_points(): number
  num_attributes(): number
  num_faces?(): number
}

interface DracoDecoderHandle {
  GetEncodedGeometryType(buffer: unknown): number
  DecodeBufferToMesh(buffer: unknown, mesh: DracoGeometryHandle): DracoStatus
  DecodeBufferToPointCloud(buffer: unknown, cloud: DracoGeometryHandle): DracoStatus
  GetAttribute(geometry: DracoGeometryHandle, index: number): DracoAttributeHandle
  GetTrianglesUInt32Array(mesh: DracoGeometryHandle, byteLength: number, pointer: number): boolean
  GetAttributeDataArrayForAllPoints(
    geometry: DracoGeometryHandle,
    attribute: DracoAttributeHandle,
    dataType: number,
    byteLength: number,
    pointer: number,
  ): boolean
}

interface DracoDecoderModule {
  readonly Decoder: new () => DracoDecoderHandle
  readonly DecoderBuffer: new () => { Init(data: Int8Array, length: number): void }
  readonly Mesh: new () => DracoGeometryHandle
  readonly PointCloud: new () => DracoGeometryHandle
  readonly TRIANGULAR_MESH: number
  readonly POINT_CLOUD: number
  readonly POSITION: number
  readonly NORMAL: number
  readonly COLOR: number
  readonly TEX_COORD: number
  readonly GENERIC: number
  readonly DT_INT8: number
  readonly DT_UINT8: number
  readonly DT_INT16: number
  readonly DT_UINT16: number
  readonly DT_INT32: number
  readonly DT_UINT32: number
  readonly DT_FLOAT32: number
  readonly HEAPU8: Uint8Array
  _malloc(length: number): number
  _free(pointer: number): void
  destroy(handle: unknown): void
}

type DracoFactory = (options: Record<string, unknown>) => Promise<DracoDecoderModule>

let runtime: Promise<DracoDecoderModule> | undefined

function cache(
  pending: Promise<DracoDecoderModule>,
  message: string,
  hint: string,
): Promise<DracoDecoderModule> {
  runtime = pending.catch(cause => {
    runtime = undefined
    if (cause instanceof ModkitError) throw cause
    throw new ModkitError({
      code: 'codec-kit/draco-runtime-unavailable',
      message,
      cause,
      context: { hint },
    })
  })
  return runtime
}

function isNodeRuntime(): boolean {
  const processValue = (globalThis as { process?: { versions?: { node?: string } } }).process
  return typeof processValue?.versions?.node === 'string'
}

/** Configure the browser runtime from a folder with `draco_decoder.js` and `draco_decoder.wasm`. */
export function initializeDracoBrowser(options: {
  readonly assetBaseUrl: string | URL
}): Promise<void> {
  if (runtime === undefined) {
    const text = String(options.assetBaseUrl)
    const base = new URL(text.endsWith('/') ? text : `${text}/`, import.meta.url)
    const moduleUrl = new URL('draco_decoder.js', base).href
    runtime = cache(
      import(/* @vite-ignore @modkitx-external-runtime */ moduleUrl).then(
        async (module: unknown) => {
          const factory = ((module as { default?: unknown }).default ??
            (globalThis as { DracoDecoderModule?: unknown }).DracoDecoderModule) as
            DracoFactory | undefined
          if (typeof factory !== 'function')
            throw new Error('draco_decoder.js does not export a decoder factory')
          return factory({ locateFile: (path: string) => new URL(path, base).href })
        },
      ),
      'Draco browser runtime failed to initialize',
      'Verify assetBaseUrl and that draco_decoder.js and draco_decoder.wasm are deployed.',
    )
  }
  return runtime.then(() => undefined)
}

function decoderModule(): Promise<DracoDecoderModule> {
  if (runtime === undefined) {
    if (!isNodeRuntime()) {
      throw new ModkitError({
        code: 'codec-kit/draco-runtime-unavailable',
        message: 'Draco decoding is not initialized in this browser host',
        context: { hint: 'Call initializeDracoBrowser({ assetBaseUrl }) before decoding.' },
      })
    }
    // Runtime-computed so browser bundlers do not crawl the Node build of the package.
    const packageName = ['draco', '3d'].join('')
    runtime = cache(
      import(/* @modkitx-external-runtime */ packageName).then((module: unknown) => {
        const exports = module as {
          createDecoderModule?: DracoFactory
          default?: { createDecoderModule?: DracoFactory }
        }
        const factory = exports.createDecoderModule ?? exports.default?.createDecoderModule
        if (typeof factory !== 'function')
          throw new Error('draco3d does not export createDecoderModule')
        return factory({})
      }),
      'Draco Node runtime failed to load',
      'Install the draco3d dependency of @modkit/codec-kit.',
    )
  }
  return runtime
}

export const DRACO_MALFORMED = 'codec-kit/draco-malformed'

function malformed(message: string): Error {
  const error = new RangeError(`Draco geometry ${message}`)
  Object.defineProperty(error, 'code', { value: DRACO_MALFORMED, enumerable: true })
  return error
}

function attributeType(module: DracoDecoderModule, value: number): DracoAttributeType {
  if (value === module.POSITION) return 'position'
  if (value === module.NORMAL) return 'normal'
  if (value === module.COLOR) return 'color'
  if (value === module.TEX_COORD) return 'texcoord'
  if (value === module.GENERIC) return 'generic'
  return 'invalid'
}

function dataType(module: DracoDecoderModule, value: number): DracoDataType {
  switch (value) {
    case module.DT_INT8:
      return 'int8'
    case module.DT_UINT8:
      return 'uint8'
    case module.DT_INT16:
      return 'int16'
    case module.DT_UINT16:
      return 'uint16'
    case module.DT_INT32:
      return 'int32'
    case module.DT_UINT32:
      return 'uint32'
    default:
      // Float32 for float attributes and for the 64-bit and boolean types Draco can dequantize.
      return 'float32'
  }
}

const BYTES: Readonly<Record<DracoDataType, number>> = Object.freeze({
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
})

function typed(type: DracoDataType, bytes: Uint8Array): DracoAttributeData {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  switch (type) {
    case 'int8':
      return new Int8Array(buffer)
    case 'uint8':
      return new Uint8Array(buffer)
    case 'int16':
      return new Int16Array(buffer)
    case 'uint16':
      return new Uint16Array(buffer)
    case 'int32':
      return new Int32Array(buffer)
    case 'uint32':
      return new Uint32Array(buffer)
    case 'float32':
      return new Float32Array(buffer)
  }
}

/** Decode one Draco bitstream (mesh or point cloud). */
export async function decodeDracoGeometry(
  bytes: Uint8Array,
  limits: DracoDecodeLimits = DEFAULT_LIMITS,
): Promise<DracoGeometry> {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Draco input must be bytes')
  const module = await decoderModule()
  const decoder = new module.Decoder()
  const buffer = new module.DecoderBuffer()
  let geometry: DracoGeometryHandle | undefined
  try {
    buffer.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength)
    const kind = decoder.GetEncodedGeometryType(buffer)
    let status: DracoStatus
    if (kind === module.TRIANGULAR_MESH) {
      geometry = new module.Mesh()
      status = decoder.DecodeBufferToMesh(buffer, geometry)
    } else if (kind === module.POINT_CLOUD) {
      geometry = new module.PointCloud()
      status = decoder.DecodeBufferToPointCloud(buffer, geometry)
    } else {
      throw malformed('has an unknown geometry type')
    }
    // `status` points at the binder's static temporary; it is read, never destroyed.
    if (!status.ok()) throw malformed(`could not be decoded: ${status.error_msg()}`)

    const pointCount = geometry.num_points()
    if (pointCount > limits.maxPoints)
      throw malformed(`has ${pointCount} points, over the ${limits.maxPoints} limit`)
    const copyOut = (byteLength: number, fill: (pointer: number) => boolean): Uint8Array => {
      const pointer = module._malloc(byteLength)
      try {
        if (!fill(pointer)) throw malformed('refused to export its data')
        return module.HEAPU8.slice(pointer, pointer + byteLength)
      } finally {
        module._free(pointer)
      }
    }
    let indices: Uint32Array | undefined
    if (kind === module.TRIANGULAR_MESH) {
      const faces = geometry.num_faces?.() ?? 0
      if (faces > limits.maxFaces)
        throw malformed(`has ${faces} faces, over the ${limits.maxFaces} limit`)
      const mesh = geometry
      const raw = copyOut(faces * 12, pointer =>
        decoder.GetTrianglesUInt32Array(mesh, faces * 12, pointer),
      )
      indices = new Uint32Array(raw.buffer, raw.byteOffset, faces * 3)
    }
    const attributes: DracoAttribute[] = []
    const count = geometry.num_attributes()
    for (let index = 0; index < count; index += 1) {
      const attribute = decoder.GetAttribute(geometry, index)
      const type = dataType(module, attribute.data_type())
      const componentCount = attribute.num_components()
      const byteLength = pointCount * componentCount * BYTES[type]
      const nativeType = type === 'float32' ? module.DT_FLOAT32 : attribute.data_type()
      const target = geometry
      const raw = copyOut(byteLength, pointer =>
        decoder.GetAttributeDataArrayForAllPoints(
          target,
          attribute,
          nativeType,
          byteLength,
          pointer,
        ),
      )
      attributes.push(
        Object.freeze({
          uniqueId: attribute.unique_id(),
          type: attributeType(module, attribute.attribute_type()),
          componentCount,
          dataType: type,
          normalized: attribute.normalized(),
          data: typed(type, raw),
        }),
      )
    }
    return Object.freeze({
      kind: kind === module.TRIANGULAR_MESH ? 'mesh' : 'point-cloud',
      pointCount,
      ...(indices === undefined ? {} : { indices }),
      attributes: Object.freeze(attributes),
    })
  } finally {
    if (geometry !== undefined) module.destroy(geometry)
    module.destroy(buffer)
    module.destroy(decoder)
  }
}
