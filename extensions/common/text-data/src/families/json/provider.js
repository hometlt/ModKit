import { parseTree, printParseErrorCode } from 'jsonc-parser'
import { createTextSyntaxProvider } from '../../shared/provider-runtime.js'
import { scalar } from '../../shared/scalars.js'
import { encodeText, failure, span } from '../../shared/text.js'

function jsonNode(node, text, counters, depth = 0) {
  counters.nodes += 1
  counters.depth = Math.max(counters.depth, depth)
  const range = span(text, node.offset, node.length)
  if (node.type === 'object') {
    return {
      kind: 'object',
      members: (node.children ?? []).map(property => ({
        key: String(property.children?.[0]?.value ?? ''),
        keyRange: span(
          text,
          property.children?.[0]?.offset ?? property.offset,
          property.children?.[0]?.length ?? 0,
        ),
        value: jsonNode(property.children?.[1], text, counters, depth + 1),
      })),
      range,
    }
  }
  if (node.type === 'array') {
    return {
      kind: 'array',
      items: (node.children ?? []).map(item => jsonNode(item, text, counters, depth + 1)),
      range,
    }
  }
  return {
    kind: 'scalar',
    value: scalar(node.value, text.slice(node.offset, node.offset + node.length)),
    range,
  }
}

function parseJson(decoded, dialect, budget) {
  const errors = []
  const root = parseTree(decoded.text, errors, {
    allowTrailingComma: dialect === 'jsonc',
    disallowComments: dialect === 'json',
  })
  if (!root || errors.length > 0) {
    const first = errors[0] ?? { error: 0, offset: 0, length: 0 }
    return failure(
      'org.modkitx/text-data-json-parse',
      printParseErrorCode(first.error),
      decoded.text,
      first.offset,
      first.length,
    )
  }
  const counters = { nodes: 0, depth: 0 }
  const converted = jsonNode(root, decoded.text, counters)
  if (counters.nodes > budget.maxNodes || counters.depth > budget.maxDepth) {
    return {
      state: 'truncated',
      document: { dialect, root: converted, trivia: [], source: decoded.source },
      truncated: { limit: counters.nodes > budget.maxNodes ? 'maxNodes' : 'maxDepth' },
      diagnostics: [],
    }
  }
  return {
    state: 'ok',
    document: { dialect, root: converted, trivia: [], source: decoded.source },
    diagnostics: [],
  }
}

function valueFromJsonNode(node) {
  if (node.kind === 'scalar') {
    if (node.value.kind === 'null') return null
    if ('value' in node.value) return node.value.value
    if (node.value.kind === 'integer') return Number(node.value.decimal)
    return Number(node.value.raw)
  }
  if (node.kind === 'array') return node.items.map(valueFromJsonNode)
  return Object.fromEntries(
    node.members.map(member => [member.key, valueFromJsonNode(member.value)]),
  )
}

export function createJsonSyntaxProvider(definition) {
  return createTextSyntaxProvider({
    contract: definition.contract,
    parse: (decoded, request) => parseJson(decoded, definition.dialect, request.budget),
    serialize(request) {
      const text = `${JSON.stringify(valueFromJsonNode(request.document.root), null, 2)}\n`
      return encodeText(text, request.document.source, request.target)
    },
  })
}
