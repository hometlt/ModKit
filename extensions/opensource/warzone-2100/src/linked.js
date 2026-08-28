import { defineLinkedExtension } from '@modkitx-x3/host'

import imgManifest from '../contributions/codec-warzone-img.json' with { type: 'json' }
import levManifest from '../contributions/codec-warzone-lev.json' with { type: 'json' }
import mapCodecManifest from '../contributions/codec-warzone2100-map.json' with { type: 'json' }
import pieManifest from '../contributions/codec-warzone-pie.json' with { type: 'json' }
import wrfManifest from '../contributions/codec-warzone-wrf.json' with { type: 'json' }
import wzManifest from '../contributions/codec-warzone-wz.json' with { type: 'json' }
import dataManifest from '../contributions/provider-data.json' with { type: 'json' }
import installationManifest from '../contributions/provider-installation.json' with { type: 'json' }
import mapManifest from '../contributions/provider-map.json' with { type: 'json' }
import mapPreviewManifest from '../contributions/provider-map-preview.json' with { type: 'json' }
import resolvedDataManifest from '../contributions/provider-resolved-data.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as img from './warzone-img/codec.js'
import * as lev from './warzone-lev/codec.js'
import * as mapCodec from './warzone2100-map/codec.js'
import * as pie from './warzone-pie/codec.js'
import * as wrf from './warzone-wrf/codec.js'
import * as wz from './warzone-wz/codec.js'
import * as dataProvider from './data-provider.js'
import * as installationProvider from './provider.js'
import * as mapProvider from './map-provider.js'
import * as mapPreviewProvider from './map-preview-provider.js'

export const warzone2100 = defineLinkedExtension({
  source: 'linked:extensions/opensource/warzone-2100',
  packageJson,
  contributions: [
    { path: 'contributions/codec-warzone-img.json', manifest: imgManifest },
    { path: 'contributions/codec-warzone-lev.json', manifest: levManifest },
    { path: 'contributions/codec-warzone2100-map.json', manifest: mapCodecManifest },
    { path: 'contributions/codec-warzone-pie.json', manifest: pieManifest },
    { path: 'contributions/codec-warzone-wrf.json', manifest: wrfManifest },
    { path: 'contributions/codec-warzone-wz.json', manifest: wzManifest },
    { path: 'contributions/provider-data.json', manifest: dataManifest },
    { path: 'contributions/provider-installation.json', manifest: installationManifest },
    { path: 'contributions/provider-map.json', manifest: mapManifest },
    { path: 'contributions/provider-map-preview.json', manifest: mapPreviewManifest },
    { path: 'contributions/provider-resolved-data.json', manifest: resolvedDataManifest },
  ],
  modules: {
    './src/warzone-img/codec.js': img,
    './src/warzone-lev/codec.js': lev,
    './src/warzone2100-map/codec.js': mapCodec,
    './src/warzone-pie/codec.js': pie,
    './src/warzone-wrf/codec.js': wrf,
    './src/warzone-wz/codec.js': wz,
    './src/data-provider.js': dataProvider,
    './src/provider.js': installationProvider,
    './src/map-provider.js': mapProvider,
    './src/map-preview-provider.js': mapPreviewProvider,
  },
})
