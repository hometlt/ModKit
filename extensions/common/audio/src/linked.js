import { defineLinkedExtension } from '@modkitx-x3/host'

import mp3Manifest from '../contributions/codec-mp3.json' with { type: 'json' }
import oggManifest from '../contributions/codec-ogg.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as mp3 from './formats/mp3/codec.js'
import * as ogg from './formats/ogg/codec.js'

export const audio = defineLinkedExtension({
  source: 'linked:extensions/common/audio',
  packageJson,
  contributions: [
    { path: 'contributions/codec-mp3.json', manifest: mp3Manifest },
    { path: 'contributions/codec-ogg.json', manifest: oggManifest },
  ],
  modules: { './src/formats/mp3/codec.js': mp3, './src/formats/ogg/codec.js': ogg },
})
