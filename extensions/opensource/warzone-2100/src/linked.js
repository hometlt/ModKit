import { defineLinkedExtension } from '@modkitx-x3/host'

import pieManifest from '../contributions/codec-warzone-pie.json' with { type: 'json' }
import wzManifest from '../contributions/codec-warzone-wz.json' with { type: 'json' }
import dataManifest from '../contributions/provider-data.json' with { type: 'json' }
import installationManifest from '../contributions/provider-installation.json' with { type: 'json' }
import mapManifest from '../contributions/provider-map.json' with { type: 'json' }
import resolvedDataManifest from '../contributions/provider-resolved-data.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as pie from './warzone-pie/codec.js'
import * as wz from './warzone-wz/codec.js'
import * as dataProvider from './data-provider.js'
import * as installationProvider from './provider.js'
import * as mapProvider from './map-provider.js'

export const warzone2100 = defineLinkedExtension({
  source: 'linked:extensions/opensource/warzone-2100',
  packageJson,
  contributions: [
    { path: 'contributions/codec-warzone-pie.json', manifest: pieManifest },
    { path: 'contributions/codec-warzone-wz.json', manifest: wzManifest },
    { path: 'contributions/provider-data.json', manifest: dataManifest },
    { path: 'contributions/provider-installation.json', manifest: installationManifest },
    { path: 'contributions/provider-map.json', manifest: mapManifest },
    { path: 'contributions/provider-resolved-data.json', manifest: resolvedDataManifest },
  ],
  modules: {
    './src/warzone-pie/codec.js': pie,
    './src/warzone-wz/codec.js': wz,
    './src/data-provider.js': dataProvider,
    './src/provider.js': installationProvider,
    './src/map-provider.js': mapProvider,
  },
})
