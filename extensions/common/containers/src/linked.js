import { defineLinkedExtension } from '@modkitx-x3/host'

import ps1CueBinManifest from '../contributions/codec-ps1-cue-bin.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as ps1CueBin from './ps1-cue-bin/codec.js'

export const containers = defineLinkedExtension({
  source: 'linked:extensions/common/containers',
  packageJson,
  contributions: [{ path: 'contributions/codec-ps1-cue-bin.json', manifest: ps1CueBinManifest }],
  modules: { './src/ps1-cue-bin/codec.js': ps1CueBin },
})
