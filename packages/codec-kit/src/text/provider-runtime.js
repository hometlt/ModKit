import { diagnostic, throwIfAborted } from '@modkit/core'
import { decodeInput, failure, lease, preflight } from './text.js'
import { treeDataSource } from './tree-data-source.js'

function decode(request) {
  try {
    return { decoded: decodeInput(request.input) }
  } catch (error) {
    return {
      failed: failure(
        'modkit/text-data-decode',
        error instanceof Error ? error.message : String(error),
      ),
    }
  }
}

export function createTextSyntaxProvider(definition) {
  const provider = {
    contract: definition.contract,
    async parse(request) {
      throwIfAborted(request.signal)
      const prepared = decode(request)
      if (prepared.failed) return prepared.failed
      const rejected = preflight(prepared.decoded, request.budget, request.signal)
      if (rejected) return rejected
      return definition.parse(prepared.decoded, request)
    },
    async serialize(request) {
      throwIfAborted(request.signal)
      const result = await definition.serialize(request)
      if (BigInt(result.bytes.byteLength) <= request.budget.maxInputBytes) return result
      return {
        ...result,
        bytes: new Uint8Array(),
        diagnostics: [
          diagnostic(
            'error',
            'modkit/text-data-output-budget',
            'serialized output exceeds maxInputBytes',
          ),
        ],
      }
    },
    async dataSource(request) {
      if (definition.dataSource) {
        throwIfAborted(request.signal)
        const prepared = decode(request)
        if (prepared.failed) {
          throw new TypeError(prepared.failed.diagnostics[0]?.message ?? 'decode failed')
        }
        const rejected = preflight(prepared.decoded, request.budget, request.signal)
        if (rejected) throw new TypeError(rejected.diagnostics[0]?.message ?? 'preflight failed')
        return lease(await definition.dataSource(prepared.decoded, request))
      }
      const parsed = await provider.parse(request)
      if (parsed.state === 'failed') {
        throw new TypeError(parsed.diagnostics[0]?.message ?? 'parse failed')
      }
      return lease(treeDataSource(parsed.document))
    },
  }
  return Object.freeze(provider)
}

export function createSelectedProvider(definition, selection, factory = createTextSyntaxProvider) {
  if (selection?.contract !== definition.contract) {
    throw new TypeError(`provider does not implement ${String(selection?.contract)}`)
  }
  return factory(definition)
}
