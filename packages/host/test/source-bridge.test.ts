import { describe, expect, it } from 'vitest'
import { isModkitError } from '@modkit/core'
import { revisionId } from '@modkit/sdk'
import { createMemorySource, type RandomAccessSource } from '@modkit/vfs'
import { artifactByteSourceFromRandomAccess } from '@modkit/host'

const options = {
  ref: { id: 'memory:test', uri: 'memory:test' },
  revision: revisionId('content-hash.sha256:test'),
} as const

describe('checked RandomAccessSource → ArtifactByteSource bridge', () => {
  it('preserves exact bigint ranges and bounded streaming', async () => {
    const source = createMemorySource('memory:test', Uint8Array.from([0, 1, 2, 3, 4, 5]))
    const bridged = await artifactByteSourceFromRandomAccess(source, options)

    expect(bridged.size).toBe(6n)
    expect([...(await bridged.read(2n, 3))]).toEqual([2, 3, 4])
    const chunks: number[] = []
    for await (const chunk of bridged.stream({ offset: 1n, length: 4n })) {
      chunks.push(...chunk)
    }
    expect(chunks).toEqual([1, 2, 3, 4])
  })

  it('rejects unsafe size and ranges instead of rounding them', async () => {
    const unsafe: RandomAccessSource = {
      id: 'memory:unsafe',
      async size() {
        return Number.MAX_SAFE_INTEGER + 1
      },
      async readAt() {
        throw new Error('must not read')
      },
      stream() {
        throw new Error('must not stream')
      },
      dispose() {
        return undefined
      },
    }
    await expect(artifactByteSourceFromRandomAccess(unsafe, options)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.host/source-size-unrepresentable',
    )

    const bridged = await artifactByteSourceFromRandomAccess(
      createMemorySource('memory:test', new Uint8Array(8)),
      options,
    )
    await expect(bridged.read(-1n, 1)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.host/source-range-unrepresentable',
    )
    await expect(bridged.read(7n, 2)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.host/source-range-unrepresentable',
    )
  })

  it('forwards cancellation and rejects hostile short reads', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      artifactByteSourceFromRandomAccess(createMemorySource('memory:test', new Uint8Array(1)), {
        ...options,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.core/operation-cancelled',
    )

    const short: RandomAccessSource = {
      id: 'memory:short',
      async size() {
        return 4
      },
      async readAt() {
        return new Uint8Array(1)
      },
      stream() {
        return new ReadableStream({ start: controller => controller.close() })
      },
      dispose() {
        return undefined
      },
    }
    const bridged = await artifactByteSourceFromRandomAccess(short, options)
    await expect(bridged.read(0n, 2)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.host/source-short-read',
    )
  })
})
