import {
  createSelectedProvider,
  createTextSyntaxProvider as createRuntimeProvider,
  encodeText,
  failure,
  span,
} from '@modkitx-x3/codec-kit/text'
import { definition } from './definition.js'

function parseIni(decoded, dialect) {
  const sections = []
  let current = { name: '', entries: [], range: span(decoded.text, 0, 0) }
  sections.push(current)
  const seen = new Set()
  let offset = 0
  for (const line of decoded.text.split(/\r\n|\r|\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      offset += line.length + 1
      continue
    }
    const section = /^\[([^\]]+)\]$/u.exec(trimmed)
    if (section) {
      current = { name: section[1], entries: [], range: span(decoded.text, offset, line.length) }
      sections.push(current)
    } else {
      const equals = line.indexOf('=')
      if (equals <= 0) {
        return failure(
          'org.modkitx/text-data-ini-parse',
          'INI entry requires a non-empty key',
          decoded.text,
          offset,
          line.length,
        )
      }
      const key = line.slice(0, equals).trim()
      const identity = `${current.name}\0${key}`
      if (dialect === 'ini-basic' && seen.has(identity)) {
        return failure(
          'org.modkitx/text-data-ini-duplicate',
          `duplicate key ${key}`,
          decoded.text,
          offset,
          line.length,
        )
      }
      seen.add(identity)
      current.entries.push({
        key,
        value: line.slice(equals + 1).trim(),
        range: span(decoded.text, offset, line.length),
      })
    }
    offset += line.length + 1
  }
  return { state: 'ok', document: { sections, source: decoded.source }, diagnostics: [] }
}

function createIniSyntaxProvider() {
  return createRuntimeProvider({
    contract: definition.contract,
    parse: (decoded, request) => parseIni(decoded, request.dialect),
    serialize(request) {
      const text = request.document.sections
        .map(
          section =>
            `${section.name ? `[${section.name}]\n` : ''}${section.entries
              .map(entry => `${entry.key}=${entry.value}`)
              .join('\n')}`,
        )
        .join('\n')
      return encodeText(text, request.document.source, request.target)
    },
  })
}

export const abiVersion = 1
export const createTextSyntaxProvider = createIniSyntaxProvider
export const createProvider = selection =>
  createSelectedProvider(definition, selection, createIniSyntaxProvider)
