import { defineLinkedExtension } from '@modkit/host'

import aacManifest from '../contributions/codec-aac.json' with { type: 'json' }
import flacManifest from '../contributions/codec-flac.json' with { type: 'json' }
import m4aManifest from '../contributions/codec-m4a.json' with { type: 'json' }
import mp3Manifest from '../contributions/codec-mp3.json' with { type: 'json' }
import oggManifest from '../contributions/codec-ogg.json' with { type: 'json' }
import wavManifest from '../contributions/codec-wav.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as aac from './aac/codec.js'
import * as flac from './flac/codec.js'
import * as mp3 from './mp3/codec.js'
import * as ogg from './ogg/codec.js'
import * as m4a from './m4a/codec.js'
import * as wav from './wav/codec.js'

export const audio = defineLinkedExtension({
  source: 'linked:extensions/audio',
  packageJson,
  contributions: [
    { path: 'contributions/codec-aac.json', manifest: aacManifest },
    { path: 'contributions/codec-flac.json', manifest: flacManifest },
    { path: 'contributions/codec-m4a.json', manifest: m4aManifest },
    { path: 'contributions/codec-mp3.json', manifest: mp3Manifest },
    { path: 'contributions/codec-ogg.json', manifest: oggManifest },
    { path: 'contributions/codec-wav.json', manifest: wavManifest },
  ],
  modules: {
    './src/aac/codec.js': aac,
    './src/flac/codec.js': flac,
    './src/m4a/codec.js': m4a,
    './src/mp3/codec.js': mp3,
    './src/ogg/codec.js': ogg,
    './src/wav/codec.js': wav,
  },
})
