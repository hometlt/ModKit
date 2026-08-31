import { defineLinkedExtension } from '@modkit/host'

import providerManifest from '../contributions/provider-software.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'

export const softwareRenderer = defineLinkedExtension({
  source: 'linked:examples/extensions/software-renderer',
  packageJson,
  contributions: [{ path: 'contributions/provider-software.json', manifest: providerManifest }],
  modules: { './src/provider.js': provider },
})
