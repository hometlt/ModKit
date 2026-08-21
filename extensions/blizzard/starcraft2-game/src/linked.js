import { defineLinkedExtension } from '@modkitx-x3/host'

import providerManifest from '../contributions/provider-installation.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'

export const starcraft2Game = defineLinkedExtension({
  source: 'linked:extensions/blizzard/starcraft2-game',
  packageJson,
  contributions: [{ path: 'contributions/provider-installation.json', manifest: providerManifest }],
  modules: { './src/provider.js': provider },
})
