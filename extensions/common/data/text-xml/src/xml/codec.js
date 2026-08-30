import { createTextCodec } from '@modkitx-x3/codec-kit/text'
import { definition } from './definition.js'

function detect(text) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  return {
    confidence: /^<\??[A-Za-z_]/u.test(text.trimStart()) ? 0.92 : 0.05,
    note: 'xml-root',
  }
}

export const abiVersion = 1
export const createCodec = context => createTextCodec({ ...definition, detect }, context)
