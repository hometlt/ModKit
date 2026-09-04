import { createBrowserFileVfsProvider } from '@modkit/vfs/providers/browser-file'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'
import { createHttpVfsProvider } from '@modkit/vfs/providers/http'
import { createMemoryVfsProvider } from '@modkit/vfs/providers/memory'
import { createRapidVfsProvider } from '@modkit/vfs/providers/rapid'
import type {
  BrowserFileInput,
  BrowserFileVfsProviderOptions,
} from '@modkit/vfs/providers/browser-file'
import type { HttpFetch } from '@modkit/vfs/providers/http'
import type { VfsLimits } from '@modkit/vfs'

import { createExtensionVfs } from './vfs.js'

export interface NodeExtensionVfsOptions {
  readonly limits?: Partial<VfsLimits>
  readonly memoryEntries?: Readonly<Record<string, Uint8Array>>
  readonly memoryAuthority?: string
  readonly browserFiles?: Readonly<Record<string, BrowserFileInput>>
  readonly browserFileResolve?: BrowserFileVfsProviderOptions['resolve']
  readonly fetch?: HttpFetch
  readonly allowedOrigins?: readonly string[]
  readonly rapidPoolRoot?: string
}

export function createNodeExtensionVfs(options: NodeExtensionVfsOptions = {}) {
  const browser = createBrowserFileVfsProvider({
    ...(options.browserFileResolve === undefined ? {} : { resolve: options.browserFileResolve }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  })
  for (const [uri, input] of Object.entries(options.browserFiles ?? {}))
    browser.register(uri, input)
  return createExtensionVfs([
    createFileVfsProvider(options.limits === undefined ? {} : { limits: options.limits }),
    createMemoryVfsProvider({
      ...(options.memoryEntries === undefined ? {} : { entries: options.memoryEntries }),
      ...(options.memoryAuthority === undefined ? {} : { authority: options.memoryAuthority }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    }),
    createHttpVfsProvider({
      scheme: 'http',
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    }),
    createHttpVfsProvider({
      scheme: 'https',
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    }),
    browser,
    createRapidVfsProvider({
      ...(options.rapidPoolRoot === undefined ? {} : { poolRoot: options.rapidPoolRoot }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    }),
  ])
}
