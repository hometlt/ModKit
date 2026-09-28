import {
  createSelectedProvider,
  createTextSyntaxProvider as createRuntimeProvider,
  encodeText,
  lease,
  parseIni,
} from '@modkit/codec-kit/text'
import { definition } from './definition.js'

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
export const provides = Object.freeze([definition.contract])
export const createTextSyntaxProvider = createIniSyntaxProvider
export const createProvider = selection =>
  lease(createSelectedProvider(definition, selection, createIniSyntaxProvider))
