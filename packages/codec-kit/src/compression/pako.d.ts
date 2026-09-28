declare module 'pako' {
  export function deflate(data: Uint8Array): Uint8Array
  export function inflate(data: Uint8Array): Uint8Array
  /** The streaming inflater; `onData` receives each output chunk as it is produced. */
  export class Inflate {
    constructor(options?: { readonly raw?: boolean; readonly chunkSize?: number })
    push(data: Uint8Array, flushMode?: boolean | number): boolean
    onData(chunk: Uint8Array): void
    readonly err: number
    readonly msg: string
    /** Output not yet handed to `onData`: pako emits only full chunks until the stream ends. */
    readonly strm: { readonly output: Uint8Array; readonly next_out: number }
  }
}
