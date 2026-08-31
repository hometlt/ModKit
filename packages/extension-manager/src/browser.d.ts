import type { VirtualFileSystem, VfsLimits } from '@modkit/vfs'
export * from './index.js'

export function createBrowserExtensionVfs(options?: {
  readonly limits?: Partial<VfsLimits>
  readonly memoryEntries?: Readonly<Record<string, Uint8Array>>
  readonly files?: Readonly<Record<string, unknown>>
  readonly resolve?: (uri: string) => unknown
  readonly fetch?: unknown
  readonly allowedOrigins?: readonly string[]
}): { readonly vfs: VirtualFileSystem; readonly protocols: readonly string[] }
