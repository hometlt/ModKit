import { defineLinkedExtension } from '@modkitx-x3/host'

import providerManifest from '../contributions/provider-installation.json' with { type: 'json' }
import workspaceManifest from '../contributions/provider-workspace.json' with { type: 'json' }
import dataManifest from '../contributions/provider-data.json' with { type: 'json' }
import resolvedDataManifest from '../contributions/provider-resolved-data.json' with { type: 'json' }
import mapManifest from '../contributions/provider-map.json' with { type: 'json' }
import mapPreviewManifest from '../contributions/provider-map-preview.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'
import * as workspaceProvider from './workspace-provider.js'
import * as dataProvider from './data-provider.js'
import * as mapProvider from './map-provider.js'
import * as mapPreviewProvider from './map-preview-provider.js'

export const starcraft2Game = defineLinkedExtension({
  source: 'linked:extensions/blizzard/starcraft2-game',
  packageJson,
  contributions: [
    { path: 'contributions/provider-installation.json', manifest: providerManifest },
    { path: 'contributions/provider-workspace.json', manifest: workspaceManifest },
    { path: 'contributions/provider-data.json', manifest: dataManifest },
    { path: 'contributions/provider-resolved-data.json', manifest: resolvedDataManifest },
    { path: 'contributions/provider-map.json', manifest: mapManifest },
    { path: 'contributions/provider-map-preview.json', manifest: mapPreviewManifest },
  ],
  modules: {
    './src/provider.js': provider,
    './src/workspace-provider.js': workspaceProvider,
    './src/data-provider.js': dataProvider,
    './src/map-provider.js': mapProvider,
    './src/map-preview-provider.js': mapPreviewProvider,
  },
})
