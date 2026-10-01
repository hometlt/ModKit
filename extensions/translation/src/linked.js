import { defineLinkedExtension } from '@modkit/host'

import providerManifest from '../contributions/provider-translation.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'

export const translation = defineLinkedExtension({
  source: 'linked:extensions/translation',
  packageJson,
  contributions: [{ path: 'contributions/provider-translation.json', manifest: providerManifest }],
  modules: {
    './src/provider.js': provider,
  },
})
