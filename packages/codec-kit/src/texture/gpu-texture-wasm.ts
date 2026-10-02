import { ModkitError } from '@modkit/core'

/**
 * Lazy runtime boundary for the optional Texture2DDecoder WASM implementation.
 *
 * Node can resolve the installed package automatically. Browser main threads and module workers
 * deliberately require an explicit asset URL so bundlers never traverse the dependency's Node
 * fallback (`import("module")`). The package build publishes the required browser assets under
 * `browser/texture2ddecoder/`.
 */

export interface GpuTextureWasmBrowserOptions {
  /** URL containing the published `wasm/` directory. A trailing slash is optional. */
  assetBaseUrl: string | URL
}

interface WasmByteVector {
  readonly length: number
  readonly [index: number]: number
  delete?(): void
}

type NativeTexture2DDecoder = Record<string, (...args: unknown[]) => WasmByteVector | null>

interface Texture2DDecoderRuntime {
  initialize?(options?: { wasmPath?: string }): Promise<void>
  decode_bc1(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_bc3(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_bc4(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_bc5(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_bc6(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_bc7(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_pvrtc(
    data: Uint8Array,
    width: number,
    height: number,
    is2bpp?: boolean,
  ): Promise<Uint8Array | null>
  decode_etc1(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_etc2(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_etc2a1(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_etc2a8(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacr(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacr_signed(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacrg(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacrg_signed(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_atc_rgb4(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_atc_rgba8(data: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_astc(
    data: Uint8Array,
    width: number,
    height: number,
    blockWidth: number,
    blockHeight: number,
  ): Promise<Uint8Array | null>
  unpack_crunch(data: Uint8Array): Promise<Uint8Array | null>
  unpack_unity_crunch(data: Uint8Array): Promise<Uint8Array | null>
}

let runtimePromise: Promise<Texture2DDecoderRuntime> | undefined

function cacheRuntime(
  pending: Promise<Texture2DDecoderRuntime>,
  message: string,
  hint?: string,
): Promise<Texture2DDecoderRuntime> {
  runtimePromise = pending.catch(cause => {
    runtimePromise = undefined
    if (cause instanceof ModkitError) throw cause
    throw new ModkitError({
      code: 'codec-kit/texture-runtime-unavailable',
      message,
      cause,
      ...(hint === undefined ? {} : { context: { hint } }),
    })
  })
  return runtimePromise
}

function runtimeExports(module: unknown): Texture2DDecoderRuntime {
  const exports = module as Texture2DDecoderRuntime & { default?: Texture2DDecoderRuntime }
  return exports.default ?? exports
}

function isNodeRuntime(): boolean {
  const processValue = (globalThis as { process?: { versions?: { node?: string } } }).process
  return typeof processValue?.versions?.node === 'string'
}

function wasmOutputToUint8Array(output: WasmByteVector | null): Uint8Array | null {
  if (!output) return null
  try {
    const bytes = new Uint8Array(output.length)
    for (let index = 0; index < output.length; index++) bytes[index] = output[index]!
    return bytes
  } finally {
    output.delete?.()
  }
}

function browserRuntime(native: NativeTexture2DDecoder): Texture2DDecoderRuntime {
  const decode =
    (name: string) =>
    async (...args: unknown[]): Promise<Uint8Array | null> =>
      wasmOutputToUint8Array(native[name]!(...args))
  return {
    decode_bc1: decode('decode_bc1'),
    decode_bc3: decode('decode_bc3'),
    decode_bc4: decode('decode_bc4'),
    decode_bc5: decode('decode_bc5'),
    decode_bc6: decode('decode_bc6'),
    decode_bc7: decode('decode_bc7'),
    decode_pvrtc: decode('decode_pvrtc'),
    decode_etc1: decode('decode_etc1'),
    decode_etc2: decode('decode_etc2'),
    decode_etc2a1: decode('decode_etc2a1'),
    decode_etc2a8: decode('decode_etc2a8'),
    decode_eacr: decode('decode_eacr'),
    decode_eacr_signed: decode('decode_eacr_signed'),
    decode_eacrg: decode('decode_eacrg'),
    decode_eacrg_signed: decode('decode_eacrg_signed'),
    decode_atc_rgb4: decode('decode_atc_rgb4'),
    decode_atc_rgba8: decode('decode_atc_rgba8'),
    decode_astc: decode('decode_astc'),
    unpack_crunch: decode('unpack_crunch'),
    unpack_unity_crunch: decode('unpack_unity_crunch'),
  }
}

/**
 * Configure and eagerly initialize software GPU texture decoding in a browser main thread or
 * module worker. Calling this again reuses the first successful initialization.
 */
export function initializeGpuTextureWasmBrowser(
  options: GpuTextureWasmBrowserOptions,
): Promise<void> {
  if (!runtimePromise) {
    const baseText = String(options.assetBaseUrl)
    const base = new URL(baseText.endsWith('/') ? baseText : `${baseText}/`, import.meta.url)
    const wasmPath = new URL('wasm/', base).href
    const moduleUrl = new URL('texture2ddecoder.js', wasmPath).href
    runtimePromise = cacheRuntime(
      import(/* @vite-ignore @modkitx-external-runtime */ moduleUrl).then(
        async (module: unknown) => {
          const createModule = (module as { default?: unknown }).default
          if (typeof createModule !== 'function') {
            throw new Error(
              'Texture2DDecoder browser runtime does not export an Emscripten factory',
            )
          }
          const native = (await createModule({
            locateFile: (path: string) => new URL(path, wasmPath).href,
          })) as NativeTexture2DDecoder
          return browserRuntime(native)
        },
      ),
      'Texture2DDecoder browser runtime failed to initialize',
      'Verify assetBaseUrl and that both texture2ddecoder.js and texture2ddecoder.wasm are deployed.',
    )
  }
  const initializedRuntime = runtimePromise
  return initializedRuntime.then(() => undefined)
}

async function decoder(): Promise<Texture2DDecoderRuntime> {
  if (!runtimePromise) {
    if (!isNodeRuntime()) {
      throw new ModkitError({
        code: 'codec-kit/texture-runtime-unavailable',
        message: 'Software GPU texture decoding is not initialized in this browser host',
        context: { hint: 'Call initializeGpuTextureWasmBrowser({ assetBaseUrl }) before decoding.' },
      })
    }
    // Keep the bare specifier runtime-computed. Browser bundlers must not crawl the dependency's
    // Node fallback; Node still resolves the ordinary installed package at runtime.
    const packageName = ['texture2ddecoder', 'wasm'].join('-')
    runtimePromise = cacheRuntime(
      import(/* @modkitx-external-runtime */ packageName).then(runtimeExports),
      'Texture2DDecoder Node runtime failed to load',
      'Install the optional texture2ddecoder-wasm dependency for software GPU texture decode.',
    )
  }
  const initializedRuntime = runtimePromise
  return initializedRuntime
}

type Decode2dName =
  | 'decode_bc1'
  | 'decode_bc3'
  | 'decode_bc4'
  | 'decode_bc5'
  | 'decode_bc6'
  | 'decode_bc7'
  | 'decode_etc1'
  | 'decode_etc2'
  | 'decode_etc2a1'
  | 'decode_etc2a8'
  | 'decode_eacr'
  | 'decode_eacr_signed'
  | 'decode_eacrg'
  | 'decode_eacrg_signed'
  | 'decode_atc_rgb4'
  | 'decode_atc_rgba8'

async function decode2d(
  name: Decode2dName,
  data: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const runtime = await decoder()
  return runtime[name](data, width, height)
}

export const decode_bc1 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_bc1', data, width, height)
export const decode_bc3 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_bc3', data, width, height)
export const decode_bc4 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_bc4', data, width, height)
export const decode_bc5 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_bc5', data, width, height)
export const decode_bc6 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_bc6', data, width, height)
export const decode_bc7 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_bc7', data, width, height)
export const decode_etc1 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_etc1', data, width, height)
export const decode_etc2 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_etc2', data, width, height)
export const decode_etc2a1 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_etc2a1', data, width, height)
export const decode_etc2a8 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_etc2a8', data, width, height)
export const decode_eacr = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_eacr', data, width, height)
export const decode_eacr_signed = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_eacr_signed', data, width, height)
export const decode_eacrg = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_eacrg', data, width, height)
export const decode_eacrg_signed = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_eacrg_signed', data, width, height)
export const decode_atc_rgb4 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_atc_rgb4', data, width, height)
export const decode_atc_rgba8 = (data: Uint8Array, width: number, height: number) =>
  decode2d('decode_atc_rgba8', data, width, height)

export async function decode_pvrtc(
  data: Uint8Array,
  width: number,
  height: number,
  is2bpp = false,
): Promise<Uint8Array | null> {
  return (await decoder()).decode_pvrtc(data, width, height, is2bpp)
}

export async function decode_astc(
  data: Uint8Array,
  width: number,
  height: number,
  blockWidth: number,
  blockHeight: number,
): Promise<Uint8Array | null> {
  return (await decoder()).decode_astc(data, width, height, blockWidth, blockHeight)
}

/**
 * A Crunch (`.crn`) payload unpacked to its GPU blocks (DXT1/DXT5/ETC/ETC2, as the header says),
 * ready for the matching decoder above; null when the data is not Crunch.
 */
export async function unpack_crunch(data: Uint8Array): Promise<Uint8Array | null> {
  return (await decoder()).unpack_crunch(data)
}

/** Unity's Crunch variant (TextureFormat DXT1Crunched, DXT5Crunched, ETC_RGB4Crunched, ETC2_RGBA8Crunched). */
export async function unpack_unity_crunch(data: Uint8Array): Promise<Uint8Array | null> {
  return (await decoder()).unpack_unity_crunch(data)
}
