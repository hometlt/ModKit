import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Inventory } from '@modkit/host'
import {
  browserImageType,
  galleryThumbnail,
  imageGalleryExtensions,
  renderGalleryThumbnail,
} from '../src/image-gallery.js'

describe('image gallery', () => {
  it('includes raster and vector image formats from enabled codecs only', () => {
    const png = JSON.parse(
      readFileSync(
        new URL('../../../extensions/images/contributions/codec-png.json', import.meta.url),
        'utf8',
      ),
    )
    const svg = {
      ...png,
      spec: {
        match: { extensions: ['SVG'] },
        publishesDataSources: [{ contract: 'common.view/vector-scene-source' }],
      },
    }
    const zip = {
      ...png,
      spec: {
        match: { extensions: ['zip'] },
        publishesDataSources: [{ contract: 'common.view/namespace-entry-source' }],
      },
    }
    const disabled = { ...png, spec: { ...png.spec, match: { extensions: ['dds'] } } }
    const inventory = {
      extensions: [
        {
          contributions: [
            { manifest: png, activationEligible: true },
            { manifest: svg, activationEligible: true },
            { manifest: zip, activationEligible: true },
            { manifest: disabled, activationEligible: false },
          ],
        },
      ],
    } as unknown as Inventory
    expect([...imageGalleryExtensions(inventory)].sort()).toEqual(['png', 'svg'])
  })

  it('resizes padded RGBA rows without stretching the image', () => {
    const thumb = galleryThumbnail(
      {
        width: 2,
        height: 2,
        rowStride: 12,
        pixelFormat: 'rgba8',
        pixels: new Uint8Array([
          255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255,
        ]),
      },
      1,
    )
    expect(thumb).toEqual({ width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, 255]) })
  })

  it('sends a vector picture as its SVG text for the page to draw (7.37)', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"/></svg>'
    const released: string[] = []
    const session = {
      async dataSource(contract: string) {
        if (contract !== 'common.view/vector-scene-source') throw new Error(`no ${contract}`)
        return {
          value: {
            async document() {
              return { mediaType: 'image/svg+xml', profile: 'uvg.secure-static.v1', text: svg }
            },
          },
          async release() {
            released.push(contract)
          },
        }
      },
      async dispose() {
        released.push('session')
      },
    }
    const thumbnail = await renderGalleryThumbnail(
      async () => ({ snapshot: {} as never, session: session as never }),
      'mod/icon.emf',
    )
    expect(thumbnail).toEqual({ svg })
    expect(released).toEqual(['common.view/vector-scene-source', 'session'])
  })

  it('sends a font as its own bytes for the page to set a sample in (7.26)', async () => {
    const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4])
    const released: string[] = []
    const session = {
      async descriptor() {
        return { traits: [{ id: 'content.fonts' }] }
      },
      async dataSource(contract: string) {
        if (contract !== 'common.view/byte-range-source') throw new Error(`no ${contract}`)
        return {
          value: {
            async size() {
              return BigInt(font.byteLength)
            },
            async read(offset: bigint, length: number) {
              return font.subarray(Number(offset), Number(offset) + length)
            },
          },
          async release() {
            released.push(contract)
          },
        }
      },
      async dispose() {
        released.push('session')
      },
    }
    const thumbnail = await renderGalleryThumbnail(
      async () => ({ snapshot: {} as never, session: session as never }),
      'mod/fonts/title.woff2',
    )
    expect(thumbnail).toEqual({ font })
    expect(released).toEqual(['common.view/byte-range-source', 'session'])
  })

  it('names the formats the page decodes itself when no codec decodes them (7.37)', () => {
    expect(browserImageType('ui/Loading.WEBP')).toBe('image/webp')
    expect(browserImageType('anim.gif')).toBe('image/gif')
    expect(browserImageType('photo.jfif')).toBe('image/jpeg')
    expect(browserImageType('unit.dds')).toBeUndefined()
    expect(browserImageType('README')).toBeUndefined()
  })
})
