import { parseDocument as parseYamlDocument, stringify as stringifyYaml } from 'yaml'
import {
  createSelectedProvider,
  createTextSyntaxProvider as createRuntimeProvider,
  encodeText,
  failure,
  lease,
  plainNode,
} from '@modkit/codec-kit/text'
import { definition } from './definition.js'

function parseYaml(decoded, budget) {
  try {
    const document = parseYamlDocument(decoded.text, {
      maxAliasCount: 0,
      strict: true,
      uniqueKeys: true,
    })
    if (document.errors.length > 0) {
      return failure('modkit/text-data-yaml-parse', document.errors[0].message, decoded.text)
    }
    const counters = { nodes: 0, depth: 0 }
    const model = {
      documents: [plainNode(document.toJS({ maxAliasCount: 0 }), decoded.text, counters)],
      trivia: [],
      source: decoded.source,
    }
    if (counters.nodes > budget.maxNodes || counters.depth > budget.maxDepth) {
      return {
        state: 'truncated',
        document: model,
        truncated: { limit: counters.nodes > budget.maxNodes ? 'maxNodes' : 'maxDepth' },
        diagnostics: [],
      }
    }
    return { state: 'ok', document: model, diagnostics: [] }
  } catch (error) {
    return failure(
      'modkit/text-data-yaml-alias',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function createYamlSyntaxProvider() {
  return createRuntimeProvider({
    contract: definition.contract,
    parse: (decoded, request) => parseYaml(decoded, request.budget),
    serialize(request) {
      const text = stringifyYaml(request.document.documents.map(node => node.kind))
      return encodeText(text, request.document.source, request.target)
    },
  })
}

export const abiVersion = 1
export const provides = Object.freeze([definition.contract])
export const createTextSyntaxProvider = createYamlSyntaxProvider
export const createProvider = selection =>
  lease(createSelectedProvider(definition, selection, createYamlSyntaxProvider))
