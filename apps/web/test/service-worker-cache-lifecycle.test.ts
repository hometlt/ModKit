import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

import { BROWSER_EXTENSION_CATALOG_CACHE } from '../src/browser-extension-manager.js'
import { MANAGED_EXTENSION_CACHE } from '../src/managed-extension-storage.js'

describe('PWA service-worker cache lifecycle', () => {
  it('removes only obsolete shell versions and preserves extension-manager caches', async () => {
    const source = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8')
    interface WaitEvent {
      waitUntil(value: Promise<unknown>): void
    }
    const listeners = new Map<string, (event: WaitEvent) => void>()
    const deleted: string[] = []
    let claimed = 0
    const current = 'modkit-mk3-shell-v3'
    const oldShell = 'modkit-mk3-shell-v2'
    const unrelated = 'another-app-cache'
    const self = {
      addEventListener(name: string, listener: (event: WaitEvent) => void) {
        listeners.set(name, listener)
      },
      clients: {
        claim: async () => {
          claimed += 1
        },
      },
      location: { origin: 'https://app.example' },
    }
    const caches = {
      keys: async () => [
        current,
        oldShell,
        MANAGED_EXTENSION_CACHE,
        BROWSER_EXTENSION_CATALOG_CACHE,
        unrelated,
      ],
      delete: async (key: string) => {
        deleted.push(key)
        return true
      },
      open: async () => ({ addAll: async () => undefined, add: async () => undefined }),
      match: async () => undefined,
    }
    vm.runInNewContext(source, {
      self,
      caches,
      fetch: async () => undefined,
      URL,
      Promise,
    })

    let activation: Promise<unknown> | undefined
    listeners.get('activate')?.({
      waitUntil(value) {
        activation = value
      },
    })
    await activation

    expect(deleted).toEqual([oldShell])
    expect(deleted).not.toContain(MANAGED_EXTENSION_CACHE)
    expect(deleted).not.toContain(BROWSER_EXTENSION_CATALOG_CACHE)
    expect(claimed).toBe(1)
  })
})
