import { defineLinkedExtension } from '@modkitx-x3/host'

import providerManifest from '../contributions/provider-galaxy.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'

export const galaxyLanguage = defineLinkedExtension({
  source: 'linked:extensions/blizzard/galaxy-language',
  packageJson,
  contributions: [{ path: 'contributions/provider-galaxy.json', manifest: providerManifest }],
  modules: { './src/provider.js': provider },
})
