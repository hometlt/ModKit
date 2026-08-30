import { defineLinkedExtension } from '@modkitx-x3/host'

import codecManifest from '../contributions/codec-toml.json' with { type: 'json' }
import contractManifest from '../contributions/contract-toml-syntax.json' with { type: 'json' }
import providerManifest from '../contributions/provider-toml-default.json' with { type: 'json' }
import writerManifest from '../contributions/writer-toml.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as codec from './toml/codec.js'
import * as provider from './toml/provider.js'

export const textToml = defineLinkedExtension({
  source: 'linked:extensions/common/data/text-toml',
  packageJson,
  contributions: [
    { path: 'contributions/codec-toml.json', manifest: codecManifest },
    { path: 'contributions/contract-toml-syntax.json', manifest: contractManifest },
    { path: 'contributions/provider-toml-default.json', manifest: providerManifest },
    { path: 'contributions/writer-toml.json', manifest: writerManifest },
  ],
  modules: {
    './src/toml/codec.js': codec,
    './src/toml/provider.js': provider,
  },
})
