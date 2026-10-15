/** Pinned obj2voxel 1.3.4 C-ABI adapter, owned by codec-kit; no worker, model bake or game operation.
 * One instance admits one raw triangle-RGB or already-baked REPEAT-atlas attempt, including failure.
 * Construction/import loads no WASM; run snapshots A1 input before its first await. Only owned,
 * digest-checked embedded bytes and official glue are used. No job URLs/factories/callbacks/options.
 * Known runtime imports retain their FILESYSTEM=0 stub semantics; the proof notification is replaced
 * internally, never reading globalThis.proofEntered. See native/obj2voxel/PROVENANCE.json/notices.
 * Explicit typed-buffer accounting is cumulative; 128 MiB WASM linear memory is separate, not RSS.
 * Signals are checked at boundaries/JS loops, not during synchronous WASM: hard cancellation needs
 * the Host's future worker owner. No capacity refund, UVM/UVW/native write or public operation claim.
 */
import { checkedProduct } from '../binary.js'
import { sha256Hex } from '../crypto/digest.js'
import type { Obj2VoxelModule } from '../lib/obj2voxel/obj2voxel.mjs'
import { snapshotVoxelBackendRequest, voxelBackendLimits } from './voxel-backend.js'
import type { VoxelBackendLimits } from './voxel-backend.js'
import { canonicalizeVoxelCells, voxelBufferAccount } from './voxel.js'
import type { VoxelBufferAccounting, VoxelGridTransform } from './voxel.js'

export type { VoxelBackendGeometry, VoxelBackendLimits, VoxelBackendRequest } from './voxel-backend.js'

export interface VoxelKernelResult extends Omit<ReturnType<typeof canonicalizeVoxelCells>, 'allocation'> {
  readonly transform: VoxelGridTransform
  readonly losses: readonly string[]
  readonly allocation: VoxelBufferAccounting
}

export interface PinnedVoxelKernel {
  /** Consumes the instance even on refusal; copies inputs before any asynchronous loading. */
  run(input: unknown, signal?: AbortSignal): Promise<VoxelKernelResult>
}

const MAX_WASM_BYTES = 128 * 1024 ** 2
const ENV_IMPORTS = ('invoke_i invoke_iiiiii invoke_vii invoke_vi invoke_viii invoke_ii ' +
  '__cxa_find_matching_catch_2 __cxa_find_matching_catch_3 __resumeException proof_input_entered ' +
  '__cxa_begin_catch invoke_iii __cxa_throw invoke_viiii invoke_viiiii invoke_v invoke_ff ' +
  'invoke_iiii invoke_iiiii __cxa_rethrow __cxa_end_catch invoke_iiiiiiiiii invoke_iiiiiiii ' +
  'invoke_iiiiiii invoke_vif invoke_ji invoke_vij invoke_viiiiii emscripten_date_now ' +
  '__syscall_openat __syscall_fcntl64 __syscall_ioctl _tzset_js _localtime_js _abort_js ' +
  'emscripten_resize_heap __cxa_uncaught_exceptions invoke_fiii invoke_diii invoke_viiiiiii ' +
  'invoke_iiiiiiiiiiii invoke_viiiiiiiiii invoke_viiiiiiiiiiiiiii').split(' ')
const WASI_IMPORTS = 'fd_write fd_read fd_close fd_seek environ_sizes_get environ_get'.split(' ')
const EXPECTED_IMPORTS = [...ENV_IMPORTS.map(name => `env.${name}:function`),
  ...WASI_IMPORTS.map(name => `wasi_snapshot_preview1.${name}:function`)].sort().join('\n')

/** Fail closed on changed binary imports; do not silently remove filesystem-named stub imports. */
function checkImports(compiled: WebAssembly.Module): void {
  const actual = WebAssembly.Module.imports(compiled)
    .map(item => `${item.module}.${item.name}:${item.kind}`).sort().join('\n')
  if (actual !== EXPECTED_IMPORTS) throw new TypeError('unexpected pinned voxel WASM imports')
}

/** Fixed trusted no-op for the proof-only notification and discarded native console output. */
function silence(): void {}

/** Re-read the current heap after growth and enforce the separately pinned linear-memory ceiling. */
function heap(module: Obj2VoxelModule): Uint8Array {
  const bytes = module.HEAPU8
  if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteOffset !== 0 ||
      bytes.byteLength !== bytes.buffer.byteLength || bytes.byteLength < 32 * 1024 ** 2 || bytes.byteLength > MAX_WASM_BYTES)
    throw new RangeError('invalid voxel WASM heap')
  return bytes
}

/** Validate every borrowed pointer/count against a fresh heap before access or C-ABI use. */
function range(module: Obj2VoxelModule, pointer: number, bytes: number, alignment = 4): Uint8Array {
  const current = heap(module)
  if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer % alignment ||
      !Number.isSafeInteger(bytes) || bytes <= 0 || pointer > current.byteLength || bytes > current.byteLength - pointer)
    throw new RangeError('invalid voxel WASM pointer/range')
  return current
}

/** Capture trusted limits now; the frozen handle contains no binary/loader injection surface. */
export function createPinnedVoxelKernel(trustedLimits: Readonly<Partial<VoxelBackendLimits>> = {}): PinnedVoxelKernel {
  const limits = voxelBackendLimits(trustedLimits)
  let consumed = false
  return Object.freeze({
    /** Snapshot synchronously and spend the one attempt before any validation, await or native work. */
    async run(input: unknown, signal?: AbortSignal): Promise<VoxelKernelResult> {
      if (consumed) throw new TypeError('voxel kernel already consumed')
      consumed = true
      const snapshot = snapshotVoxelBackendRequest(input, limits, signal)
      const account = voxelBufferAccount(limits.maxAccountedBytes, snapshot.allocation.accountedBytes)
      const [{ OBJ2VOXEL_WASM_BASE64, OBJ2VOXEL_WASM_SHA256 }, { default: createModule }] =
        await Promise.all([import('../lib/obj2voxel/wasm.js'), import('../lib/obj2voxel/obj2voxel.mjs')])
      signal?.throwIfAborted()
      // The pinned asset size bounds decoding before allocation; digest.ts owns its own full copy+32B result.
      const wasmLength = 492_351
      if (OBJ2VOXEL_WASM_BASE64.length !== Math.ceil(wasmLength / 3) * 4)
        throw new RangeError('pinned voxel base64 length mismatch')
      account.reserve(wasmLength)
      // Existing JPEG XR owner pattern: platform atob, not another base64 parser/algorithm.
      const wasm = Uint8Array.from(globalThis.atob(OBJ2VOXEL_WASM_BASE64), char => char.charCodeAt(0))
      if (wasm.byteLength !== wasmLength) throw new RangeError('pinned voxel WASM byte length mismatch')
      account.reserve(wasmLength); account.reserve(32)
      if (await sha256Hex(wasm) !== OBJ2VOXEL_WASM_SHA256) throw new TypeError('pinned voxel WASM digest mismatch')
      signal?.throwIfAborted()
      const compiled = await WebAssembly.compile(wasm)
      checkImports(compiled)
      signal?.throwIfAborted()
      const module = await createModule({ print: silence, printErr: silence,
        instantiateWasm(imports, receive) {
          // Do not invoke the generated proof thunk: even a getter on globalThis must never be read.
          const env = { ...imports['env'], proof_input_entered: silence }
          const instance = new WebAssembly.Instance(compiled, { ...imports, env })
          receive(instance)
          return instance.exports
        },
      })
      signal?.throwIfAborted()
      const pointers: { pointer: number; bytes: number }[] = []
      /** Borrow only owned snapshots; malloc can grow the heap, so never retain an old view. */
      function put(bytes: Float32Array | Uint8Array): number {
        signal?.throwIfAborted()
        const pointer = module._malloc(bytes.byteLength)
        const current = range(module, pointer, bytes.byteLength)
        pointers.push({ pointer, bytes: bytes.byteLength })
        current.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), pointer)
        return pointer
      }
      try {
        const geometry = snapshot.request.geometry
        const positions = put(geometry.positions)
        let colours = 0, uvs = 0, pixels = 0, width = 0, height = 0
        if (geometry.kind === 'triangle-rgb') colours = put(geometry.triangleRgb)
        else {
          width = geometry.atlas.width; height = geometry.atlas.height
          const rgbLength = checkedProduct(checkedProduct(width, height, 'atlas pixels'), 3, 'RGB24 bytes')
          account.reserve(rgbLength)
          const rgb = new Uint8Array(rgbLength)
          for (let source = 0, target = 0; source < geometry.atlas.rgba.length; source += 4, target += 3) {
            if ((source & 4095) === 0) signal?.throwIfAborted()
            rgb[target] = geometry.atlas.rgba[source]!
            rgb[target + 1] = geometry.atlas.rgba[source + 1]!
            rgb[target + 2] = geometry.atlas.rgba[source + 2]!
          }
          account.reserve(geometry.uvs.byteLength)
          const bottomUvs = new Float32Array(geometry.uvs.length)
          for (let i = 0; i < bottomUvs.length; i++) {
            if ((i & 1023) === 0) signal?.throwIfAborted()
            bottomUvs[i] = i % 2 ? 1 - geometry.uvs[i]! : geometry.uvs[i]!
          }
          uvs = put(bottomUvs); pixels = put(rgb)
        }
        for (const item of pointers) range(module, item.pointer, item.bytes)
        signal?.throwIfAborted()
        const status = module._proof_run(positions, colours, uvs, snapshot.triangles,
          geometry.kind === 'triangle-rgb' ? 1 : 2, pixels, width, height,
          snapshot.request.resolution, limits.maxRawCells, 0)
        heap(module)
        if (status !== 0) throw new RangeError(`voxel C ABI refused output (${status})`)
        signal?.throwIfAborted()
        const count = module._proof_count(), pointer = module._proof_output()
        if (!Number.isSafeInteger(count) || count < 1 || count > limits.maxRawCells)
          throw new RangeError('voxel raw output count/empty refusal')
        const byteLength = checkedProduct(count, 16, 'voxel output bytes')
        const current = range(module, pointer, byteLength)
        account.reserve(byteLength)
        const raw = new Uint8Array(byteLength), output = new DataView(raw.buffer)
        const native = new DataView(current.buffer, pointer, byteLength)
        for (let i = 0; i < byteLength; i += 4) {
          if ((i & 16383) === 0) signal?.throwIfAborted()
          output.setUint32(i, native.getUint32(i, true), false)
        }
        const held = account.snapshot()
        const canonical = canonicalizeVoxelCells(raw, { resolution: snapshot.request.resolution,
          maxRawCells: limits.maxRawCells, maxAccountedBytes: limits.maxAccountedBytes,
          retainedBytes: held.accountedBytes - raw.byteLength, maxSortComparisons: limits.maxSortComparisons,
          ...(signal ? { signal } : {}),
        })
        const allocation = Object.freeze({ accountedBytes: canonical.allocation.accountedBytes,
          allocatedBytes: snapshot.allocation.allocatedBytes + held.allocatedBytes + canonical.allocation.allocatedBytes,
          bufferAllocations: snapshot.allocation.bufferAllocations + held.bufferAllocations + canonical.allocation.bufferAllocations })
        return Object.freeze({ ...canonical, transform: snapshot.transform, losses: snapshot.losses, allocation })
      } finally {
        for (const item of pointers) module._free(item.pointer)
      }
    },
  })
}
