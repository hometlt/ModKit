import { createTextCodec } from '../../shared/codec-runtime.js'
import { definition } from './definition.js'

function detect(text, uri) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  const extension = uri.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
  return {
    confidence: /^(?:\[[^\]]+\]|[\w.-]+\s*=)/mu.test(text)
      ? extension === 'toml'
        ? 0.88
        : 0.68
      : 0.1,
    note: 'toml-shape',
  }
}

export const abiVersion = 1
export const createCodec = context => createTextCodec({ ...definition, detect }, context)
