import { defineLinkedExtension } from '@modkitx-x3/host'

import csvCodecManifest from '../contributions/codec-csv.json' with { type: 'json' }
import tsvCodecManifest from '../contributions/codec-tsv.json' with { type: 'json' }
import csvContractManifest from '../contributions/contract-csv-syntax.json' with { type: 'json' }
import tsvContractManifest from '../contributions/contract-tsv-syntax.json' with { type: 'json' }
import csvProviderManifest from '../contributions/provider-csv-default.json' with { type: 'json' }
import tsvProviderManifest from '../contributions/provider-tsv-default.json' with { type: 'json' }
import writerManifest from '../contributions/writer-delimited.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as csvCodec from './families/delimited/entrypoints/csv-codec.js'
import * as csvProvider from './families/delimited/entrypoints/csv-provider.js'
import * as tsvCodec from './families/delimited/entrypoints/tsv-codec.js'
import * as tsvProvider from './families/delimited/entrypoints/tsv-provider.js'

export const textDelimited = defineLinkedExtension({
  source: 'linked:extensions/common/data/text-delimited',
  packageJson,
  contributions: [
    { path: 'contributions/codec-csv.json', manifest: csvCodecManifest },
    { path: 'contributions/codec-tsv.json', manifest: tsvCodecManifest },
    { path: 'contributions/contract-csv-syntax.json', manifest: csvContractManifest },
    { path: 'contributions/contract-tsv-syntax.json', manifest: tsvContractManifest },
    { path: 'contributions/provider-csv-default.json', manifest: csvProviderManifest },
    { path: 'contributions/provider-tsv-default.json', manifest: tsvProviderManifest },
    { path: 'contributions/writer-delimited.json', manifest: writerManifest },
  ],
  modules: {
    './src/families/delimited/entrypoints/csv-codec.js': csvCodec,
    './src/families/delimited/entrypoints/csv-provider.js': csvProvider,
    './src/families/delimited/entrypoints/tsv-codec.js': tsvCodec,
    './src/families/delimited/entrypoints/tsv-provider.js': tsvProvider,
  },
})
