/**
 * What a warm realm may and may not share.
 *
 * The saving is real — a second open of the same codec went from ~190 ms to ~15 ms. It is sound
 * because a realm carries code, not authority: the grant lives in each activation's own context
 * and in the gate's checks at dispatch. So the rules pinned here are about the *code* — the same
 * code is loaded once, different code never shares a realm — and about lifetime: a realm in use is
 * not torn down by someone else's release, and a failed activation is not cached as if it worked.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PermissionGrant } from '@modkit/sdk'
import { warmExecutionBackend } from '../src/execution/warm-backend.js'
import type { ExecutionBackend, ExecutionBackendActivation } from '../src/execution/backend.js'

const grant = (id: string, classes: readonly string[] = ['read-source']): PermissionGrant =>
  ({ id, classes }) as unknown as PermissionGrant

const activation = (
  contributionId: string,
  grantValue: PermissionGrant,
): ExecutionBackendActivation =>
  ({
    ticket: {
      contributionId,
      artifactDigest: 'sha256:artifact',
      target: { environment: 'node-worker' },
    },
    entrypoint: new URL('file:///codec.js'),
    artifactRoot: new URL('file:///root/'),
    variant: {
      variantId: 'portable',
      executionProfile: 'worker-brokered',
      entrypoint: './codec.js',
    },
    target: { environment: 'node-worker' },
    grant: grantValue,
  }) as unknown as ExecutionBackendActivation

function counting(): { backend: ExecutionBackend; loads: () => number; releases: () => number } {
  let loads = 0
  let releases = 0
  return {
    loads: () => loads,
    releases: () => releases,
    backend: {
      profile: 'worker-brokered',
      supports: () => true,
      activate: () => {
        loads += 1
        return {
          module: { createCodec: () => undefined },
          release: async () => {
            releases += 1
          },
        }
      },
    },
  }
}

describe('warm execution realms', () => {
  it('loads once for repeated opens of the same code under the same authority', async () => {
    const inner = counting()
    const warm = warmExecutionBackend(inner.backend, { idleMs: 10_000 })

    const first = await warm.activate(activation('modkit/dds', grant('vscode:s1')))
    await first.release()
    const second = await warm.activate(activation('modkit/dds', grant('vscode:s2')))

    expect(inner.loads()).toBe(1)
    // Released by its first user, kept for the second: the inner lease is still open.
    expect(inner.releases()).toBe(0)
    await second.release()
  })

  it('shares one load between grants, because a realm carries no authority', async () => {
    // The probe runs narrowed to the probe classes and the open with `write-source`: one realm.
    const inner = counting()
    const warm = warmExecutionBackend(inner.backend, { idleMs: 10_000 })

    const probe = await warm.activate(activation('modkit/dds', grant('vscode:s1')))
    const open = await warm.activate(
      activation('modkit/dds', grant('vscode:s1/open', ['read-source', 'write-source'])),
    )

    expect(inner.loads()).toBe(1)
    await probe.release()
    await open.release()
  })

  it('never shares a realm between different code', async () => {
    const inner = counting()
    const warm = warmExecutionBackend(inner.backend, { idleMs: 10_000 })

    const dds = await warm.activate(activation('modkit/dds', grant('vscode:s1')))
    const png = await warm.activate(activation('modkit/png', grant('vscode:s1')))

    expect(inner.loads()).toBe(2)
    await dds.release()
    await png.release()
  })

  it('keeps a realm alive while anyone still holds it, and releases it after the idle window', async () => {
    vi.useFakeTimers()
    try {
      const inner = counting()
      const warm = warmExecutionBackend(inner.backend, { idleMs: 1_000 })
      const held = await warm.activate(activation('modkit/png', grant('vscode:s1')))
      const shared = await warm.activate(activation('modkit/png', grant('vscode:s2')))

      await shared.release()
      vi.advanceTimersByTime(5_000)
      // One user is still holding it: an idle timer must not have been armed at all.
      expect(inner.releases()).toBe(0)

      await held.release()
      vi.advanceTimersByTime(999)
      expect(inner.releases()).toBe(0)
      vi.advanceTimersByTime(2)
      await Promise.resolve()
      expect(inner.releases()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cache a failed activation', async () => {
    let attempts = 0
    const backend: ExecutionBackend = {
      profile: 'worker-brokered',
      supports: () => true,
      activate: () => {
        attempts += 1
        if (attempts === 1) throw new Error('worker died during load')
        return { module: {}, release: async () => undefined }
      },
    }
    const warm = warmExecutionBackend(backend, { idleMs: 10_000 })

    await expect(warm.activate(activation('modkit/tga', grant('vscode:s1')))).rejects.toThrow(
      /worker died/u,
    )
    const second = await warm.activate(activation('modkit/tga', grant('vscode:s2')))
    expect(attempts).toBe(2)
    await second.release()
  })
})
