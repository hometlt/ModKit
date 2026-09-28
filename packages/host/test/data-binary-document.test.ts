import { describe, expect, it } from 'vitest'
import { revisionId, type ResourceSessionPort } from '@modkit/sdk'
import { readResourceText } from '../src/data/index.js'

const bytes = Uint8Array.of(0x57, 0x33, 0x64, 0x6f, 0xff, 0x00)
const revision = revisionId('provider-token:binary-document')
const resources = {
  state: () => 'live',
  async resolve() {
    return {
      state: 'resolved',
      revision,
      provenance: {},
      lease: {
        value: {
          kind: 'bytes',
          ref: { id: 'war3map.w3u', uri: 'test:war3map.w3u' },
          revision,
          size: BigInt(bytes.byteLength),
          async *stream() {
            yield bytes
          },
        },
        release: async () => undefined,
      },
    }
  },
} as unknown as ResourceSessionPort

describe('a binary data document', () => {
  it('reaches the provider as bytes, undecoded, and a text one as text', async () => {
    const requirement = {
      requirementId: 'w3u',
      rootId: 'map',
      path: 'war3map.w3u',
      kind: 'catalog' as const,
    }
    const binary = await readResourceText(resources, { ...requirement, encoding: 'binary' }, 1024)
    if (binary.state !== 'resolved') throw new Error('expected resolved')
    expect(binary.text).toBe('')
    expect([...(binary.bytes ?? [])]).toEqual([...bytes])
    const text = await readResourceText(resources, requirement, 1024)
    if (text.state !== 'resolved') throw new Error('expected resolved')
    expect(text.bytes).toBeUndefined()
    expect(text.text.startsWith('W3do')).toBe(true)
  })
})

describe('a data document that opens but cannot be read', () => {
  it('is unresolved with the reason, not a failed workspace', async () => {
    let released = 0
    const broken = {
      state: () => 'live',
      async resolve() {
        return {
          state: 'resolved',
          revision,
          provenance: {},
          lease: {
            value: {
              kind: 'bytes',
              ref: { id: 'Rules.txt', uri: 'test:Rules.txt' },
              revision,
              size: 10n,
              // eslint-disable-next-line require-yield
              async *stream() {
                throw new Error('retail RFH entry Rules.txt is stored in the sibling RFD')
              },
            },
            release: async () => {
              released += 1
            },
          },
        }
      },
    } as unknown as ResourceSessionPort
    const loaded = await readResourceText(
      broken,
      {
        requirementId: 'rules',
        rootId: 'game',
        path: 'Rules.txt',
        kind: 'catalog',
        required: false,
      },
      1024,
    )
    expect(loaded.state).toBe('unresolved')
    if (loaded.state !== 'unresolved') return
    expect(loaded.diagnostic.code).toBe('x3.host/resolved-data-resource-read-failed')
    expect(loaded.diagnostic.message).toContain('sibling RFD')
    expect(released).toBe(1)
  })
})
