import { defineLinkedExtension } from '@modkit/host'

import codecCsvManifest from '../contributions/codec-csv.json' with { type: 'json' }
import codecIniManifest from '../contributions/codec-ini.json' with { type: 'json' }
import codecSlkManifest from '../contributions/codec-slk.json' with { type: 'json' }
import codecTomlManifest from '../contributions/codec-toml.json' with { type: 'json' }
import codecTsvManifest from '../contributions/codec-tsv.json' with { type: 'json' }
import codecXmlManifest from '../contributions/codec-xml.json' with { type: 'json' }
import codecYamlManifest from '../contributions/codec-yaml.json' with { type: 'json' }
import contractCsvManifest from '../contributions/contract-csv-syntax.json' with { type: 'json' }
import contractIniManifest from '../contributions/contract-ini-syntax.json' with { type: 'json' }
import contractSlkManifest from '../contributions/contract-slk-syntax.json' with { type: 'json' }
import contractTomlManifest from '../contributions/contract-toml-syntax.json' with { type: 'json' }
import contractTsvManifest from '../contributions/contract-tsv-syntax.json' with { type: 'json' }
import contractXmlManifest from '../contributions/contract-xml-syntax.json' with { type: 'json' }
import contractYamlManifest from '../contributions/contract-yaml-syntax.json' with { type: 'json' }
import providerCsvManifest from '../contributions/provider-csv-default.json' with { type: 'json' }
import providerIniManifest from '../contributions/provider-ini-default.json' with { type: 'json' }
import providerSlkManifest from '../contributions/provider-slk-default.json' with { type: 'json' }
import providerTomlManifest from '../contributions/provider-toml-default.json' with { type: 'json' }
import providerTsvManifest from '../contributions/provider-tsv-default.json' with { type: 'json' }
import providerXmlManifest from '../contributions/provider-xml-default.json' with { type: 'json' }
import providerYamlManifest from '../contributions/provider-yaml-default.json' with { type: 'json' }
import writerDelimitedManifest from '../contributions/writer-delimited.json' with { type: 'json' }
import writerIniManifest from '../contributions/writer-ini.json' with { type: 'json' }
import writerTomlManifest from '../contributions/writer-toml.json' with { type: 'json' }
import writerXmlManifest from '../contributions/writer-xml.json' with { type: 'json' }
import writerYamlManifest from '../contributions/writer-yaml.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as csvCodec from './families/delimited/entrypoints/csv-codec.js'
import * as csvProvider from './families/delimited/entrypoints/csv-provider.js'
import * as tsvCodec from './families/delimited/entrypoints/tsv-codec.js'
import * as tsvProvider from './families/delimited/entrypoints/tsv-provider.js'
import * as iniCodec from './ini/codec.js'
import * as iniProvider from './ini/provider.js'
import * as slkCodec from './slk/codec.js'
import * as slkProvider from './slk/provider.js'
import * as tomlCodec from './toml/codec.js'
import * as tomlProvider from './toml/provider.js'
import * as xmlCodec from './xml/codec.js'
import * as xmlProvider from './xml/provider.js'
import * as yamlCodec from './yaml/codec.js'
import * as yamlProvider from './yaml/provider.js'
import * as delimitedWriter from './editing/delimited-writer.js'
import * as iniWriter from './editing/ini-writer.js'
import * as tomlWriter from './editing/toml-writer.js'
import * as xmlWriter from './editing/xml-writer.js'
import * as yamlWriter from './editing/yaml-writer.js'

export const data = defineLinkedExtension({
  source: 'linked:extensions/data',
  packageJson,
  contributions: [
    { path: 'contributions/codec-csv.json', manifest: codecCsvManifest },
    { path: 'contributions/codec-ini.json', manifest: codecIniManifest },
    { path: 'contributions/codec-slk.json', manifest: codecSlkManifest },
    { path: 'contributions/codec-toml.json', manifest: codecTomlManifest },
    { path: 'contributions/codec-tsv.json', manifest: codecTsvManifest },
    { path: 'contributions/codec-xml.json', manifest: codecXmlManifest },
    { path: 'contributions/codec-yaml.json', manifest: codecYamlManifest },
    { path: 'contributions/contract-csv-syntax.json', manifest: contractCsvManifest },
    { path: 'contributions/contract-ini-syntax.json', manifest: contractIniManifest },
    { path: 'contributions/contract-slk-syntax.json', manifest: contractSlkManifest },
    { path: 'contributions/contract-toml-syntax.json', manifest: contractTomlManifest },
    { path: 'contributions/contract-tsv-syntax.json', manifest: contractTsvManifest },
    { path: 'contributions/contract-xml-syntax.json', manifest: contractXmlManifest },
    { path: 'contributions/contract-yaml-syntax.json', manifest: contractYamlManifest },
    { path: 'contributions/provider-csv-default.json', manifest: providerCsvManifest },
    { path: 'contributions/provider-ini-default.json', manifest: providerIniManifest },
    { path: 'contributions/provider-slk-default.json', manifest: providerSlkManifest },
    { path: 'contributions/provider-toml-default.json', manifest: providerTomlManifest },
    { path: 'contributions/provider-tsv-default.json', manifest: providerTsvManifest },
    { path: 'contributions/provider-xml-default.json', manifest: providerXmlManifest },
    { path: 'contributions/provider-yaml-default.json', manifest: providerYamlManifest },
    { path: 'contributions/writer-delimited.json', manifest: writerDelimitedManifest },
    { path: 'contributions/writer-ini.json', manifest: writerIniManifest },
    { path: 'contributions/writer-toml.json', manifest: writerTomlManifest },
    { path: 'contributions/writer-xml.json', manifest: writerXmlManifest },
    { path: 'contributions/writer-yaml.json', manifest: writerYamlManifest },
  ],
  modules: {
    './src/families/delimited/entrypoints/csv-codec.js': csvCodec,
    './src/families/delimited/entrypoints/csv-provider.js': csvProvider,
    './src/families/delimited/entrypoints/tsv-codec.js': tsvCodec,
    './src/families/delimited/entrypoints/tsv-provider.js': tsvProvider,
    './src/ini/codec.js': iniCodec,
    './src/ini/provider.js': iniProvider,
    './src/slk/codec.js': slkCodec,
    './src/slk/provider.js': slkProvider,
    './src/toml/codec.js': tomlCodec,
    './src/toml/provider.js': tomlProvider,
    './src/xml/codec.js': xmlCodec,
    './src/xml/provider.js': xmlProvider,
    './src/yaml/codec.js': yamlCodec,
    './src/yaml/provider.js': yamlProvider,
    './src/editing/delimited-writer.js': delimitedWriter,
    './src/editing/ini-writer.js': iniWriter,
    './src/editing/toml-writer.js': tomlWriter,
    './src/editing/xml-writer.js': xmlWriter,
    './src/editing/yaml-writer.js': yamlWriter,
  },
})
