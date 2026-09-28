import { createTextCodec } from '@modkit/codec-kit/text'
import { definition } from './definition.js'

// SYLK opens with an ID record (`ID;PWXL;N;E`); the extension alone is weak evidence.
function detect(text, uri) {
  const extension = uri.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
  return {
    confidence: /^ID;/u.test(text) ? (extension === 'slk' ? 0.9 : 0.6) : 0.05,
    note: 'sylk-id-record',
  }
}

export const abiVersion = 1
export const createCodec = context => createTextCodec({ ...definition, detect }, context)
