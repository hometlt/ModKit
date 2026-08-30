import { createTextCodec } from '@modkitx-x3/codec-kit/text'
import { definition } from './definition.js'

function detect(text) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  return {
    confidence: /^(?:---\s*$|[-?]?\s*[\w"']+\s*:)/mu.test(text) ? 0.72 : 0.15,
    note: 'yaml-shape',
  }
}

export const abiVersion = 1
export const createCodec = context => createTextCodec({ ...definition, detect }, context)
