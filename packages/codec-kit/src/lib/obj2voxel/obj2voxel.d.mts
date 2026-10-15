/** Declaration for pinned Emscripten-generated glue; not a public Modkit job interface. */
export interface Obj2VoxelModule {
  readonly HEAPU8: Uint8Array
  readonly HEAPF32: Float32Array
  readonly HEAPU32: Uint32Array
  _malloc(bytes: number): number
  _free(pointer: number): void
  _proof_run(positions: number, colours: number, uvs: number, triangles: number, mode: number, pixels: number, width: number, height: number, resolution: number, maxCells: number, clamp: number): number
  _proof_output(): number
  _proof_count(): number
}
/** Caller is the trusted owner kernel, never a job-provided options object. */
export interface Obj2VoxelFactoryOptions {
  readonly instantiateWasm: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => WebAssembly.Exports
  readonly print: (text: string) => void
  readonly printErr: (text: string) => void
}
export default function createModule(options: Obj2VoxelFactoryOptions): Promise<Obj2VoxelModule>
