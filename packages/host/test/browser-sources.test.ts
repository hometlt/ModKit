import { describe, expect, it } from 'vitest'
import { collectStream } from '@modkit/vfs'
import {
  createBrowserFileHandleSource,
  createHttpRangeSource,
  type BrowserFetch,
} from '@modkit/host/browser'

describe('browser host sources', () => {
  it('adapts a File System Access snapshot without ambient filesystem authority', async () => {
    const bytes = new TextEncoder().encode('modkit')
    const source = await createBrowserFileHandleSource('handle:test', {
      async getFile() {
        return {
          size: bytes.length,
          slice(start, end) {
            return {
              async arrayBuffer() {
                return bytes.slice(start, end).buffer
              },
            }
          },
        }
      },
    })
    expect(new TextDecoder().decode(await source.readAt(1, 3))).toBe('odk')
    expect(new TextDecoder().decode(await collectStream(source.stream()))).toBe('modkit')
  })

  it('requires honest 206 responses and exact range lengths', async () => {
    const bytes = new TextEncoder().encode('0123456789')
    const fetcher: BrowserFetch = async (_url, init) => {
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          status: 200,
          headers: {
            get: name =>
              name === 'content-length' ? '10' : name === 'accept-ranges' ? 'bytes' : null,
          },
          async arrayBuffer() {
            return new ArrayBuffer(0)
          },
        }
      }
      const range = init?.headers?.['Range'] ?? ''
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match === null) throw new TypeError('missing range')
      const start = Number(match[1])
      const end = Number(match[2]) + 1
      const body = bytes.slice(start, end)
      return {
        ok: true,
        status: 206,
        headers: { get: () => null },
        async arrayBuffer() {
          return body.buffer
        },
      }
    }
    const source = await createHttpRangeSource('https://example.invalid/asset.bin', {
      fetch: fetcher,
    })
    expect(new TextDecoder().decode(await source.readAt(3, 4))).toBe('3456')
  })
})
