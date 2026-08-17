import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import {
  createSelectedProvider,
  createTextSyntaxProvider as createRuntimeProvider,
  encodeText,
  failure,
  scalar,
  span,
} from '@modkitx-x3/codec-kit/text'
import { definition } from './definition.js'

function tomlValue(value, text) {
  const range = span(text)
  if (Array.isArray(value)) {
    return { kind: 'array', items: value.map(item => tomlValue(item, text)), range }
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return {
      kind: 'inline-table',
      entries: Object.entries(value).map(([key, item]) => ({
        path: [key],
        value: tomlValue(item, text),
        range,
      })),
      range,
    }
  }
  return { kind: 'scalar', value: scalar(value), range }
}

function parseTomlDocument(decoded) {
  try {
    const value = parseToml(decoded.text)
    return {
      state: 'ok',
      document: {
        entries: Object.entries(value).map(([key, item]) => ({
          path: [key],
          value: tomlValue(item, decoded.text),
          range: span(decoded.text),
        })),
        source: decoded.source,
      },
      diagnostics: [],
    }
  } catch (error) {
    return failure(
      'org.modkitx/text-data-toml-parse',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function createTomlSyntaxProvider() {
  return createRuntimeProvider({
    contract: definition.contract,
    parse: decoded => parseTomlDocument(decoded),
    serialize(request) {
      const text = stringifyToml(
        Object.fromEntries(
          request.document.entries.map(entry => [
            entry.path.join('.'),
            entry.value.kind === 'scalar' && 'value' in entry.value.value
              ? entry.value.value.value
              : '',
          ]),
        ),
      )
      return encodeText(text, request.document.source, request.target)
    },
  })
}

export const abiVersion = 1
export const createTextSyntaxProvider = createTomlSyntaxProvider
export const createProvider = selection =>
  createSelectedProvider(definition, selection, createTomlSyntaxProvider)
