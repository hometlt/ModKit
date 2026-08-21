import { defineLinkedExtension } from '@modkitx-x3/host'

import mp4Manifest from '../contributions/codec-mp4.json' with { type: 'json' }
import webmManifest from '../contributions/codec-webm.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as mp4 from './formats/mp4/codec.js'
import * as webm from './formats/webm/codec.js'

export const video = defineLinkedExtension({
  source: 'linked:extensions/common/video',
  packageJson,
  contributions: [
    { path: 'contributions/codec-mp4.json', manifest: mp4Manifest },
    { path: 'contributions/codec-webm.json', manifest: webmManifest },
  ],
  modules: {
    './src/formats/mp4/codec.js': mp4,
    './src/formats/webm/codec.js': webm,
  },
})
