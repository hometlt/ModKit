import type { TextureDecodeDiagnostic, TextureDecodeResult } from './texture-codec.js'

/**
 * Full normalized path — two textures named "diffuse.dds" in different
 * folders stay distinct.
 */
export function normalizeTexturePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

export interface TextureCacheEntry {
  path: string
  result: TextureDecodeResult
}

export class TextureCache {
  private readonly entries = new Map<string, Promise<TextureDecodeResult>>()

  constructor(
    private readonly decode: (
      bytes: Uint8Array,
      hint?: string,
    ) => Promise<TextureDecodeResult> | TextureDecodeResult,
  ) {}

  has(path: string): boolean {
    return this.entries.has(normalizeTexturePath(path))
  }

  /**
   * Decode-once per normalized full path. Failures are cached too so a missing
   * texture is reported once, not re-attempted every frame.
   */
  getOrDecode(
    path: string,
    loadBytes: () => Promise<Uint8Array> | Uint8Array,
  ): Promise<TextureDecodeResult> {
    const key = normalizeTexturePath(path)
    let pending = this.entries.get(key)
    if (!pending) {
      pending = Promise.resolve()
        .then(loadBytes)
        .then(
          bytes => this.decode(bytes, path),
          (error): TextureDecodeResult => ({
            ok: false,
            diagnostic: {
              code: 'texture-read-failed',
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        )
      this.entries.set(key, pending)
    }
    return pending
  }

  delete(path: string): boolean {
    return this.entries.delete(normalizeTexturePath(path))
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  /** Per-path failure report for the viewer's texture diagnostics panel. */
  async diagnostics(): Promise<{ path: string; diagnostic: TextureDecodeDiagnostic }[]> {
    const failures: { path: string; diagnostic: TextureDecodeDiagnostic }[] = []
    for (const [path, pending] of this.entries) {
      const result = await pending
      if (!result.ok) failures.push({ path, diagnostic: result.diagnostic })
    }
    return failures
  }
}
