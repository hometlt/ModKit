import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Inventory } from '@modkit/host'
import { galleryThumbnail, imageGalleryExtensions } from '../src/image-gallery.js'

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
})
