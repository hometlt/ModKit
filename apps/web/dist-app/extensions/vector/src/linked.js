import { defineLinkedExtension } from '@modkit/host'

import emfManifest from '../contributions/codec-emf.json' with { type: 'json' }
import fontManifest from '../contributions/codec-font.json' with { type: 'json' }
import svgManifest from '../contributions/codec-svg.json' with { type: 'json' }
import wmfManifest from '../contributions/codec-wmf.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as emf from './emf/codec.js'
import * as font from './font/codec.js'
import * as svg from './svg/codec.js'
import * as wmf from './wmf/codec.js'

export const vector = defineLinkedExtension({
  source: 'linked:extensions/vector',
  packageJson,
  contributions: [
    { path: 'contributions/codec-emf.json', manifest: emfManifest },
    { path: 'contributions/codec-font.json', manifest: fontManifest },
    { path: 'contributions/codec-svg.json', manifest: svgManifest },
    { path: 'contributions/codec-wmf.json', manifest: wmfManifest },
  ],
  modules: {
    './src/emf/codec.js': emf,
    './src/font/codec.js': font,
    './src/svg/codec.js': svg,
    './src/wmf/codec.js': wmf,
  },
})
