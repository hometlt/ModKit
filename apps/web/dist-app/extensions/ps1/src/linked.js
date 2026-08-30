import { defineLinkedExtension } from '@modkitx-x3/host'

import ps1CueBinManifest from '../contributions/codec-ps1-cue-bin.json' with { type: 'json' }
import ps1XaManifest from '../contributions/codec-ps1-xa.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as ps1CueBin from './ps1-cue-bin/codec.js'
import * as ps1Xa from './ps1-xa/codec.js'

export const ps1 = defineLinkedExtension({
  source: 'linked:extensions/ps1',
  packageJson,
  contributions: [
    { path: 'contributions/codec-ps1-cue-bin.json', manifest: ps1CueBinManifest },
    { path: 'contributions/codec-ps1-xa.json', manifest: ps1XaManifest },
  ],
  modules: {
    './src/ps1-cue-bin/codec.js': ps1CueBin,
    './src/ps1-xa/codec.js': ps1Xa,
  },
})
