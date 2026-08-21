import { defineLinkedExtension } from '@modkitx-x3/host'

import svgManifest from '../contributions/codec-svg.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as svg from './formats/svg/codec.js'

export const vector = defineLinkedExtension({
  source: 'linked:extensions/common/vector',
  packageJson,
  contributions: [{ path: 'contributions/codec-svg.json', manifest: svgManifest }],
  modules: { './src/formats/svg/codec.js': svg },
})
