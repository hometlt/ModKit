import { defineLinkedExtension } from '@modkitx-x3/host'

import jsonCodecManifest from '../contributions/codec-json.json' with { type: 'json' }
import jsoncCodecManifest from '../contributions/codec-jsonc.json' with { type: 'json' }
import jsonContractManifest from '../contributions/contract-json-syntax.json' with { type: 'json' }
import jsoncContractManifest from '../contributions/contract-jsonc-syntax.json' with { type: 'json' }
import jsonProviderManifest from '../contributions/provider-json-default.json' with { type: 'json' }
import jsoncProviderManifest from '../contributions/provider-jsonc-default.json' with { type: 'json' }
import writerManifest from '../contributions/writer-json.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as jsonCodec from './families/json/entrypoints/json-codec.js'
import * as jsonProvider from './families/json/entrypoints/json-provider.js'
import * as jsoncCodec from './families/json/entrypoints/jsonc-codec.js'
import * as jsoncProvider from './families/json/entrypoints/jsonc-provider.js'

export const textJson = defineLinkedExtension({
  source: 'linked:extensions/common/text-json',
  packageJson,
  contributions: [
    { path: 'contributions/codec-json.json', manifest: jsonCodecManifest },
    { path: 'contributions/codec-jsonc.json', manifest: jsoncCodecManifest },
    { path: 'contributions/contract-json-syntax.json', manifest: jsonContractManifest },
    { path: 'contributions/contract-jsonc-syntax.json', manifest: jsoncContractManifest },
    { path: 'contributions/provider-json-default.json', manifest: jsonProviderManifest },
    { path: 'contributions/provider-jsonc-default.json', manifest: jsoncProviderManifest },
    { path: 'contributions/writer-json.json', manifest: writerManifest },
  ],
  modules: {
    './src/families/json/entrypoints/json-codec.js': jsonCodec,
    './src/families/json/entrypoints/json-provider.js': jsonProvider,
    './src/families/json/entrypoints/jsonc-codec.js': jsoncCodec,
    './src/families/json/entrypoints/jsonc-provider.js': jsoncProvider,
  },
})
