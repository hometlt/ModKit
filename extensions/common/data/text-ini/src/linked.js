import { defineLinkedExtension } from '@modkitx-x3/host'

import codecManifest from '../contributions/codec-ini.json' with { type: 'json' }
import contractManifest from '../contributions/contract-ini-syntax.json' with { type: 'json' }
import providerManifest from '../contributions/provider-ini-default.json' with { type: 'json' }
import writerManifest from '../contributions/writer-ini.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as codec from './ini/codec.js'
import * as provider from './ini/provider.js'

export const textIni = defineLinkedExtension({
  source: 'linked:extensions/common/data/text-ini',
  packageJson,
  contributions: [
    { path: 'contributions/codec-ini.json', manifest: codecManifest },
    { path: 'contributions/contract-ini-syntax.json', manifest: contractManifest },
    { path: 'contributions/provider-ini-default.json', manifest: providerManifest },
    { path: 'contributions/writer-ini.json', manifest: writerManifest },
  ],
  modules: {
    './src/ini/codec.js': codec,
    './src/ini/provider.js': provider,
  },
})
