import { createTextCodec } from '@modkit/codec-kit/text'
import { definition } from './definition.js'

/*
 * A root tag says the bytes are XML, not what they are: StarCraft II's GameData catalogs, and every
 * other game format that happens to be XML, are recognised by codecs that read their schema and
 * report around 0.9. Claiming 0.92 for the syntax alone outranked all of them and opened a catalog
 * as an anonymous tree. Syntax without a schema stays below any codec that recognised the document,
 * which is still the only claim on a plain XML file.
 */
function detect(text) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  return {
    confidence: /^<\??[A-Za-z_]/u.test(text.trimStart()) ? 0.55 : 0.05,
    note: 'xml-root',
  }
}

export const abiVersion = 1
export const createCodec = context => createTextCodec({ ...definition, detect }, context)
