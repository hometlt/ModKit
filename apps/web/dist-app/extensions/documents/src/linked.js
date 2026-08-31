import { defineLinkedExtension } from '@modkitx-x3/host'

import markdownManifest from '../contributions/codec-markdown.json' with { type: 'json' }
import odgManifest from '../contributions/codec-odg.json' with { type: 'json' }
import odpManifest from '../contributions/codec-odp.json' with { type: 'json' }
import odsManifest from '../contributions/codec-ods.json' with { type: 'json' }
import odtManifest from '../contributions/codec-odt.json' with { type: 'json' }
import rtfManifest from '../contributions/codec-rtf.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as markdown from './markdown/codec.js'
import * as odg from './odg/codec.js'
import * as odp from './odp/codec.js'
import * as ods from './ods/codec.js'
import * as odt from './odt/codec.js'
import * as rtf from './rtf/codec.js'

export const documents = defineLinkedExtension({
  source: 'linked:extensions/documents',
  packageJson,
  contributions: [
    { path: 'contributions/codec-markdown.json', manifest: markdownManifest },
    { path: 'contributions/codec-odg.json', manifest: odgManifest },
    { path: 'contributions/codec-odp.json', manifest: odpManifest },
    { path: 'contributions/codec-ods.json', manifest: odsManifest },
    { path: 'contributions/codec-odt.json', manifest: odtManifest },
    { path: 'contributions/codec-rtf.json', manifest: rtfManifest },
  ],
  modules: {
    './src/markdown/codec.js': markdown,
    './src/odg/codec.js': odg,
    './src/odp/codec.js': odp,
    './src/ods/codec.js': ods,
    './src/odt/codec.js': odt,
    './src/rtf/codec.js': rtf,
  },
})
