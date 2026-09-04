import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sourceRoot = new URL('../src/', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && specifier.startsWith('.')) {
      const target = new URL(specifier, context.parentURL)
      if (target.href.startsWith(sourceRoot) && target.pathname.endsWith('.js')) {
        target.pathname = target.pathname.slice(0, -3) + '.ts'
        if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})
