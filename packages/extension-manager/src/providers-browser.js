import { createBrowserFileVfsProvider } from '@modkitx-x3/vfs/providers/browser-file'
import { createHttpVfsProvider } from '@modkitx-x3/vfs/providers/http'
import { createMemoryVfsProvider } from '@modkitx-x3/vfs/providers/memory'

import { createExtensionVfs } from './vfs.js'

export function createBrowserExtensionVfs(options = {}) {
  const browser = createBrowserFileVfsProvider({
    ...(options.resolve === undefined ? {} : { resolve: options.resolve }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  })
  for (const [uri, input] of Object.entries(options.files ?? {})) browser.register(uri, input)
  return createExtensionVfs([
    createMemoryVfsProvider({
      ...(options.memoryEntries === undefined ? {} : { entries: options.memoryEntries }),
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
  ])
}
