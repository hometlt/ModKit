import { defineLinkedExtension } from '@modkitx-x3/host'

import editorManifest from '../contributions/editor-monaco-code.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as editor from './index.js'

export const uiMonaco = defineLinkedExtension({
  source: 'linked:extensions/common/ui/monaco',
  packageJson,
  contributions: [{ path: 'contributions/editor-monaco-code.json', manifest: editorManifest }],
  modules: { './src/index.js': editor },
})
