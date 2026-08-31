import { describe, expect, it } from 'vitest'
import type {
  ExtensionManagerClient,
  ExtensionManagerEntry,
} from '@modkit/extension-manager/browser'

import { createManagedExtensionsController } from '../src/managed-extensions-controller.js'

const entry = (overrides: Partial<ExtensionManagerEntry> = {}): ExtensionManagerEntry => ({
  id: 'org.example/toolkit',
  displayName: 'Example toolkit',
  publisher: 'org.example',
  availableVersion: '2.0.0',
  enabled: false,
  updateAvailable: false,
  source: 'https://cdn.example.invalid/toolkit.mkx',
  trusted: true,
  ...overrides,
})

function fakeClient(initial: readonly ExtensionManagerEntry[] = []): {
  readonly client: ExtensionManagerClient
  readonly calls: string[]
  set(entries: readonly ExtensionManagerEntry[]): void
} {
  let entries = initial
  const calls: string[] = []
  return {
    calls,
    set(next) {
      entries = next
    },
    client: {
      async snapshot() {
        calls.push('snapshot')
        return { entries }
      },
      async refresh() {
        calls.push('refresh')
      },
      async install(id) {
        calls.push(`install:${id}`)
      },
      async update(id) {
        calls.push(`update:${id}`)
      },
      async remove(id) {
        calls.push(`remove:${id}`)
      },
      async setEnabled(id, enabled) {
        calls.push(`enable:${id}:${String(enabled)}`)
      },
    },
  }
}

describe('managed extensions page controller', () => {
  it('maps the common client snapshot without duplicating trust decisions', async () => {
    const shared = fakeClient([
      entry({
        installedVersion: '1.0.0',
        enabled: true,
        updateAvailable: true,
        trusted: false,
      }),
    ])
    const controller = createManagedExtensionsController({
      client: shared.client,
      catalogLocation: 'fake signed registry',
    })

    expect(controller.snapshot().rows).toEqual([])
    const model = await controller.refreshInstalled()
    expect(shared.calls).toEqual(['snapshot'])
    expect(model.rows[0]).toMatchObject({
      available: true,
      installed: true,
      enabled: true,
      updateAvailable: true,
      trusted: false,
    })
    expect(model.rows[0]?.trustReason).toContain('common extension manager did not verify')
  })

  it('refreshes the registry only through the explicit refresh action', async () => {
    const shared = fakeClient([entry()])
    const controller = createManagedExtensionsController({
      client: shared.client,
      catalogLocation: 'fake registry',
    })
    await controller.refreshInstalled()
    expect(shared.calls).not.toContain('refresh')
    const refreshed = await controller.refreshCatalog()
    expect(shared.calls).toEqual(['snapshot', 'refresh', 'snapshot'])
    expect(refreshed.catalogLoaded).toBe(true)
  })

  it('delegates every mutation to the common client and then reads its local snapshot', async () => {
    const shared = fakeClient([entry({ installedVersion: '1.0.0', enabled: true })])
    const controller = createManagedExtensionsController({
      client: shared.client,
      catalogLocation: 'fake registry',
    })

    await controller.install('org.example/toolkit')
    await controller.update('org.example/toolkit')
    await controller.enable('org.example/toolkit', false)
    await controller.remove('org.example/toolkit')
    expect(shared.calls).toEqual([
      'install:org.example/toolkit',
      'snapshot',
      'update:org.example/toolkit',
      'snapshot',
      'enable:org.example/toolkit:false',
      'snapshot',
      'remove:org.example/toolkit',
      'snapshot',
    ])
  })
})
