import { defineLinkedExtension } from '@modkitx-x3/host'

import emfManifest from '../contributions/codec-emf.json' with { type: 'json' }
import svgManifest from '../contributions/codec-svg.json' with { type: 'json' }
import wmfManifest from '../contributions/codec-wmf.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as emf from './emf/codec.js'
import * as svg from './formats/svg/codec.js'
import * as wmf from './wmf/codec.js'

export const vector = defineLinkedExtension({
  source: 'linked:extensions/common/vector',
  packageJson,
  contributions: [
    { path: 'contributions/codec-emf.json', manifest: emfManifest },
    { path: 'contributions/codec-svg.json', manifest: svgManifest },
    { path: 'contributions/codec-wmf.json', manifest: wmfManifest },
  ],
  modules: {
    './src/emf/codec.js': emf,
    './src/formats/svg/codec.js': svg,
    './src/wmf/codec.js': wmf,
  },
})
