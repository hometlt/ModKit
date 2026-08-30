import { defineLinkedExtension } from '@modkitx-x3/host'

import browserManifest from '../contributions/provider-browser.json' with { type: 'json' }
import headlessManifest from '../contributions/provider-headless.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as browser from './browser.js'
import * as headless from './headless.js'

export const rendering3d = defineLinkedExtension({
  source: 'linked:extensions/common/rendering/rendering-3d',
  packageJson,
  contributions: [
    { path: 'contributions/provider-browser.json', manifest: browserManifest },
    { path: 'contributions/provider-headless.json', manifest: headlessManifest },
  ],
  modules: { './src/browser.js': browser, './src/headless.js': headless },
})
