import { createBrowserFileVfsProvider } from '@modkitx-x3/vfs/providers/browser-file'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { createHttpVfsProvider } from '@modkitx-x3/vfs/providers/http'
import { createMemoryVfsProvider } from '@modkitx-x3/vfs/providers/memory'
import { createRapidVfsProvider } from '@modkitx-x3/vfs/providers/rapid'

import { createExtensionVfs } from './vfs.js'

export function createNodeExtensionVfs(options = {}) {
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
