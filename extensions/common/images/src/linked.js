import { defineLinkedExtension } from '@modkitx-x3/host'

import jpegManifest from '../contributions/codec-jpeg.json' with { type: 'json' }
import pngManifest from '../contributions/codec-png.json' with { type: 'json' }
import pngWriterManifest from '../contributions/writer-png.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as jpeg from './formats/jpeg/codec.js'
import * as png from './formats/png/codec.js'

export const images = defineLinkedExtension({
  source: 'linked:extensions/common/images',
  packageJson,
  contributions: [
    { path: 'contributions/codec-jpeg.json', manifest: jpegManifest },
    { path: 'contributions/codec-png.json', manifest: pngManifest },
    { path: 'contributions/writer-png.json', manifest: pngWriterManifest },
  ],
  modules: { './src/formats/jpeg/codec.js': jpeg, './src/formats/png/codec.js': png },
})
