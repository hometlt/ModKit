import { defineLinkedExtension } from '@modkitx-x3/host'

import aviManifest from '../contributions/codec-avi.json' with { type: 'json' }
import mp4Manifest from '../contributions/codec-mp4.json' with { type: 'json' }
import mpegManifest from '../contributions/codec-mpeg.json' with { type: 'json' }
import ogvManifest from '../contributions/codec-ogv.json' with { type: 'json' }
import webmManifest from '../contributions/codec-webm.json' with { type: 'json' }
import wmvManifest from '../contributions/codec-wmv.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as avi from './avi/codec.js'
import * as mp4 from './formats/mp4/codec.js'
import * as webm from './formats/webm/codec.js'
import * as mpeg from './mpeg/codec.js'
import * as ogv from './ogv/codec.js'
import * as wmv from './wmv/codec.js'

export const video = defineLinkedExtension({
  source: 'linked:extensions/common/video',
  packageJson,
  contributions: [
    { path: 'contributions/codec-avi.json', manifest: aviManifest },
    { path: 'contributions/codec-mp4.json', manifest: mp4Manifest },
    { path: 'contributions/codec-mpeg.json', manifest: mpegManifest },
    { path: 'contributions/codec-ogv.json', manifest: ogvManifest },
    { path: 'contributions/codec-webm.json', manifest: webmManifest },
    { path: 'contributions/codec-wmv.json', manifest: wmvManifest },
  ],
  modules: {
    './src/avi/codec.js': avi,
    './src/formats/mp4/codec.js': mp4,
    './src/formats/webm/codec.js': webm,
    './src/mpeg/codec.js': mpeg,
    './src/ogv/codec.js': ogv,
    './src/wmv/codec.js': wmv,
  },
})
