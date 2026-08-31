import { defineBuiltinModule } from '@modkitx-x3/host'

import editorManifest from '../contributions/editor-monaco-code.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }

/*
 * Keep the composition descriptor safe to import from Electron main, Node tests and catalog
 * tooling. Monaco imports browser CSS and DOM-facing code, so the actual editor is loaded only
 * when a visual host mounts this contribution. Browser application catalogs may still import
 * `@modkitx-x3/code` directly when they want the eager editor objects.
 */
const lazyEditor = Object.freeze({
  abiVersion: 1,
  default: Object.freeze({
    async mount(args) {
      const { monacoEditor } = await import('./editor.js')
      return monacoEditor.mount(args)
    },
  }),
})

/** Built-in code workspace implementation composed explicitly by visual applications. */
export const codeModule = defineBuiltinModule({
  coordinate: 'org.modkitx/code',
  packageJson,
  contributions: [{ path: 'contributions/editor-monaco-code.json', manifest: editorManifest }],
  modules: { './src/index.js': lazyEditor },
})

/** @deprecated Compatibility alias for compositions that still import the former extension. */
export const uiMonaco = codeModule
