import { defineLinkedExtension } from '@modkit/host'

import providerManifest from '../contributions/provider-counter.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'

export const counterRuntime = defineLinkedExtension({
  source: 'linked:examples/extensions/counter-runtime',
  packageJson,
  contributions: [{ path: 'contributions/provider-counter.json', manifest: providerManifest }],
  modules: { './src/provider.js': provider },
})
