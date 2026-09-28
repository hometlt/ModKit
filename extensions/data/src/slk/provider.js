import {
  createSelectedProvider,
  createTextSyntaxProvider as createRuntimeProvider,
  encodeText,
  formatSylk,
  lease,
  parseSylk,
  sylkTableDataSource,
} from '@modkit/codec-kit/text'
import { definition } from './definition.js'

function createSlkSyntaxProvider() {
  return createRuntimeProvider({
    contract: definition.contract,
    parse: (decoded, request) => parseSylk(decoded, request.budget),
    serialize: request =>
      encodeText(formatSylk(request.document), request.document.source, request.target),
    dataSource(decoded, request) {
      const parsed = parseSylk(decoded, request.budget)
      if (parsed.state === 'failed') throw new TypeError(parsed.diagnostics[0]?.message ?? 'SYLK parse failed')
      return sylkTableDataSource(parsed.document)
    },
  })
}

export const abiVersion = 1
export const provides = Object.freeze([definition.contract])
export const createTextSyntaxProvider = createSlkSyntaxProvider
export const createProvider = selection =>
  lease(createSelectedProvider(definition, selection, createSlkSyntaxProvider))
