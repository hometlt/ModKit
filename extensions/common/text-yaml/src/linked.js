import { defineLinkedExtension } from '@modkitx-x3/host'

import codecManifest from '../contributions/codec-yaml.json' with { type: 'json' }
import contractManifest from '../contributions/contract-yaml-syntax.json' with { type: 'json' }
import providerManifest from '../contributions/provider-yaml-default.json' with { type: 'json' }
import writerManifest from '../contributions/writer-yaml.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as codec from './formats/yaml/codec.js'
import * as provider from './formats/yaml/provider.js'

export const textYaml = defineLinkedExtension({
  source: 'linked:extensions/common/text-yaml',
  packageJson,
  contributions: [
    { path: 'contributions/codec-yaml.json', manifest: codecManifest },
    { path: 'contributions/contract-yaml-syntax.json', manifest: contractManifest },
    { path: 'contributions/provider-yaml-default.json', manifest: providerManifest },
    { path: 'contributions/writer-yaml.json', manifest: writerManifest },
  ],
  modules: {
    './src/formats/yaml/codec.js': codec,
    './src/formats/yaml/provider.js': provider,
  },
})
