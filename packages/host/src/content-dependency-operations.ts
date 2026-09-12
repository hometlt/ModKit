import { diagnostic, type Diagnostic } from '@modkit/core'
import type { AnyDescriptor, OperationSession } from '@modkit/sdk'
import type { ContentDependencyRequest } from '@modkit/vfs/content-sources'
import {
  analyzeReadOnlyContentDependencies,
  type AnalyzeReadOnlyContentDependenciesRequest,
} from './content-dependencies.js'
import type { AnalyzedResolvedDataWorkspace } from './data/index.js'

const DEFAULT_DEPENDENCY_OPERATION = 'content.resolve-dependencies'

export interface ReadOperationContentDependenciesRequest {
  readonly descriptor: Pick<AnyDescriptor, 'operations'>
  readonly operations: OperationSession
  readonly operationId?: string
  readonly signal?: AbortSignal
}

export type ReadOperationContentDependenciesResult =
  | Readonly<{
      state: 'resolved'
      dependencies: ContentDependencyRequest
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

export interface AnalyzeOperationContentDependenciesRequest
  extends Omit<AnalyzeReadOnlyContentDependenciesRequest, 'dependencies'>,
    ReadOperationContentDependenciesRequest {}

function dependencyRequest(value: unknown): ContentDependencyRequest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Readonly<Record<string, unknown>>
  if (
    record['schemaVersion'] !== 1 ||
    typeof record['gameId'] !== 'string' ||
    record['gameId'].length === 0 ||
    record['gameId'].length > 256 ||
    typeof record['complete'] !== 'boolean' ||
    !Array.isArray(record['dependencies']) ||
    record['dependencies'].length > 256
  ) {
    return undefined
  }
  return value as ContentDependencyRequest
}

/** Invoke the standard dependency operation without granting the codec access to content sources. */
export async function readOperationContentDependencies(
  request: ReadOperationContentDependenciesRequest,
): Promise<ReadOperationContentDependenciesResult> {
  request.signal?.throwIfAborted()
  const operationId = request.operationId ?? DEFAULT_DEPENDENCY_OPERATION
  const declaration = request.descriptor.operations.find(operation => operation.id === operationId)
  if (declaration === undefined || declaration.state !== 'available') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([diagnostic(
        'information',
        'x3.host/content-dependency-operation-unavailable',
        declaration?.reason ?? `the subject does not provide ${operationId}`,
      )]),
    })
  }
  const result = await request.operations.invoke(
    declaration.handlerId,
    {},
    request.signal === undefined ? undefined : { signal: request.signal },
  )
  if (result.state !== 'ok') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...result.diagnostics,
        diagnostic(
          'warning',
          'x3.host/content-dependency-operation-rejected',
          `${operationId} was rejected: ${result.reason}`,
        ),
      ]),
    })
  }
  const dependencies = result.output.kind === 'json'
    ? dependencyRequest(result.output.value)
    : undefined
  if (dependencies === undefined) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...result.diagnostics,
        diagnostic(
          'warning',
          'x3.host/content-dependency-operation-invalid',
          `${operationId} did not return a bounded schemaVersion 1 dependency request`,
        ),
      ]),
    })
  }
  return Object.freeze({
    state: 'resolved',
    dependencies,
    diagnostics: Object.freeze([...result.diagnostics]),
  })
}

/**
 * Turn a subject-owned dependency operation into the normal host-owned resolved Data workspace.
 * Physical cache paths and source credentials remain inside ContentSources and ResourceSession.
 */
export async function analyzeOperationContentDependencies(
  request: AnalyzeOperationContentDependenciesRequest,
): Promise<AnalyzedResolvedDataWorkspace> {
  const discovered = await readOperationContentDependencies(request)
  if (discovered.state === 'unresolved') return discovered
  const analyzed = await analyzeReadOnlyContentDependencies({
    contentSources: request.contentSources,
    dependencies: discovered.dependencies,
    workspaceId: request.workspaceId,
    services: request.services,
    grant: request.grant,
    budgets: request.budgets,
    locales: request.locales,
    queries: request.queries,
    ...(request.localizationKeys === undefined ? {} : { localizationKeys: request.localizationKeys }),
    limits: request.limits,
    ...(request.maximumEntryBytes === undefined ? {} : { maximumEntryBytes: request.maximumEntryBytes }),
    ...(request.resourceLimits === undefined ? {} : { resourceLimits: request.resourceLimits }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (analyzed.state === 'unresolved') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([...discovered.diagnostics, ...analyzed.diagnostics]),
    })
  }
  let released = false
  return Object.freeze({
    ...analyzed,
    diagnostics: Object.freeze([...discovered.diagnostics, ...analyzed.diagnostics]),
    async release() {
      if (released) return
      released = true
      await analyzed.release()
    },
  })
}
