import { createBrowserFileVfsProvider } from '@modkit/vfs/providers/browser-file'
import { createHttpVfsProvider } from '@modkit/vfs/providers/http'
import { createMemoryVfsProvider } from '@modkit/vfs/providers/memory'
import type {
  BrowserFileInput,
  BrowserFileVfsProviderOptions,
} from '@modkit/vfs/providers/browser-file'
import type { HttpFetch } from '@modkit/vfs/providers/http'
import type { VfsLimits } from '@modkit/vfs'

import { createExtensionVfs } from './vfs.js'

export interface BrowserExtensionVfsOptions {
  readonly limits?: Partial<VfsLimits>
  readonly memoryEntries?: Readonly<Record<string, Uint8Array>>
  // Preserve the published opaque injection boundary; the VFS providers validate these inputs.
  readonly files?: Readonly<Record<string, unknown>>
  readonly resolve?: (uri: string) => unknown
  readonly fetch?: unknown
  readonly allowedOrigins?: readonly string[]
}

export function createBrowserExtensionVfs(options: BrowserExtensionVfsOptions = {}) {
  const browser = createBrowserFileVfsProvider({
    ...(options.resolve === undefined
      ? {}
      : { resolve: options.resolve as NonNullable<BrowserFileVfsProviderOptions['resolve']> }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  })
  for (const [uri, input] of Object.entries(options.files ?? {}))
    browser.register(uri, input as BrowserFileInput)
  return createExtensionVfs([
    createMemoryVfsProvider({
      ...(options.memoryEntries === undefined ? {} : { entries: options.memoryEntries }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    }),
    createHttpVfsProvider({
      scheme: 'http',
      ...(options.fetch === undefined ? {} : { fetch: options.fetch as HttpFetch }),
      ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    }),
    createHttpVfsProvider({
      scheme: 'https',
      ...(options.fetch === undefined ? {} : { fetch: options.fetch as HttpFetch }),
      ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    }),
    browser,
  ])
}
