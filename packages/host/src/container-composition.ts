/** Host-owned container -> semantic namespace composition. No format-specific policy belongs here. */

import { ModkitError, throwIfAborted } from '@modkit/core'
import {
  revisionIdFromRef,
  type AnyDescriptor,
  type ArtifactNamespaceSource,
  type ArtifactSource,
  type AssetEditPlan,
  type AssetNamespace,
  type AssetNamespaceEntry,
  type AssetSession,
  type AssetSourceRef,
  type CodecContributionSpecV1Wire,
  type ContainerPackInputV1,
  type JsonValue,
  type Lease,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type OperationResult,
  type OperationSession,
  type ResourceBudget,
  type RevisionId,
  type SourceEdit,
  type SubjectEditTarget,
} from '@modkit/sdk'
import { containerEntryRevision, containerEntrySource } from './namespace-origin.js'

const NAMESPACE_ENTRY_SOURCE = 'common.view/namespace-entry-source'
const CONTAINER_EXTRACT = 'container.extract'
const CONTAINER_PACK = 'container.pack'
const EXPORT_RAW = 'export.raw'
const ENTRY_NOT_FOUND = 'x3.host/namespace-entry-not-found'
const PAGE_LIMIT = 256
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

interface EntryBinding {
  readonly entryId: string
  readonly path: string
  readonly ref: AssetSourceRef
  readonly providerRevision: RevisionId
  readonly sourceRevision: RevisionId
}

export interface ContainerNamespaceComposition {
  readonly source: ArtifactNamespaceSource
  readonly descriptor: AnyDescriptor
  readonly packHandlerId?: string
  readonly exportRawHandlerId?: string
  wrapSession(
    semantic: AssetSession,
    semanticSpec: CodecContributionSpecV1Wire,
    parent: AssetSession,
  ): AssetSession
  dispose(): Promise<void>
}

export interface CreateContainerNamespaceCompositionOptions {
  readonly parent: AssetSession
  readonly root: AssetSourceRef
  readonly revision: RevisionId
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal
}

function operationHandler(descriptor: AnyDescriptor, id: string): string | undefined {
  const operation = descriptor.operations.find(item => item.id === id && item.state === 'available')
  return operation?.handlerId
}

function normalizePath(path: string, allowEmpty: boolean): string {
  if (path.includes('\u0000') || path.includes('\\') || path.startsWith('/')) {
    throw new ModkitError({
      code: 'x3.host/namespace-path-refused',
      message: `container namespace path «${path}» is not a confined POSIX path`,
      context: { path },
    })
  }
  const parts = path.split('/').filter(part => part !== '' && part !== '.')
  if (parts.some(part => part === '..') || (!allowEmpty && parts.length === 0)) {
    throw new ModkitError({
      code: 'x3.host/namespace-path-refused',
      message: `container namespace path «${path}» escapes or does not name an entry`,
      context: { path },
    })
  }
  return parts.join('/')
}

function childRef(root: AssetSourceRef, path: string): AssetSourceRef {
  const parentIds = Object.freeze([...(root.parentIds ?? []), root.id]) as readonly [
    string,
    ...string[],
  ]
  return Object.freeze({
    id: `${root.id}!/${path}`,
    uri: `container-entry:${encodeURIComponent(root.uri)}!/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    parentIds,
  })
}

function encodeBase64(bytes: Uint8Array): string {
  let encoded = ''
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const value = (first << 16) | (second << 8) | third
    encoded += BASE64[(value >>> 18) & 63]
    encoded += BASE64[(value >>> 12) & 63]
    encoded += index + 1 < bytes.byteLength ? BASE64[(value >>> 6) & 63] : '='
    encoded += index + 2 < bytes.byteLength ? BASE64[value & 63] : '='
  }
  return encoded
}

function sameRef(left: AssetSourceRef, right: AssetSourceRef): boolean {
  return (
    left.id === right.id &&
    left.uri === right.uri &&
    JSON.stringify(left.parentIds ?? []) === JSON.stringify(right.parentIds ?? [])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isSourceRef(value: unknown): value is AssetSourceRef {
  return (
    isRecord(value) &&
    isNonBlank(value['id']) &&
    isNonBlank(value['uri']) &&
    (value['parentIds'] === undefined ||
      (Array.isArray(value['parentIds']) && value['parentIds'].every(isNonBlank)))
  )
}

function isEntryTarget(value: unknown): value is SubjectEditTarget {
  if (!isRecord(value) || !isSourceRef(value['ownerSource'])) return false
  const revision = value['expectedRevision']
  return (
    isNonBlank(value['targetId']) &&
    isNonBlank(value['subjectUri']) &&
    value['subjectUri'] === value['ownerSource'].uri &&
    Array.isArray(value['semanticPath']) &&
    value['semanticPath'].every(isNonBlank) &&
    isRecord(revision) &&
    isNonBlank(revision['compositionFingerprint']) &&
    isRecord(revision['bindings']) &&
    Object.keys(revision['bindings']).length > 0 &&
    Object.entries(revision['bindings']).every(
      ([bindingId, bindingRevision]) => isNonBlank(bindingId) && isNonBlank(bindingRevision),
    ) &&
    (revision['namespaceRevision'] === undefined || isNonBlank(revision['namespaceRevision']))
  )
}

function revisionMatches(target: SubjectEditTarget, binding: EntryBinding): boolean {
  return Object.values(target.expectedRevision.bindings).some(
    revision => revision === binding.sourceRevision,
  )
}

function invalidEntryPlan(message: string, context?: Record<string, unknown>): never {
  throw new ModkitError({
    code: 'x3.host/container-entry-edit-plan-invalid',
    message,
    ...(context === undefined ? {} : { context }),
  })
}

function replacementsFromPlan(
  plan: AssetEditPlan,
  bindings: ReadonlyMap<string, EntryBinding>,
  budget: ResourceBudget,
): ContainerPackInputV1['replacements'] {
  if (
    !isRecord(plan) ||
    !Array.isArray(plan.targets) ||
    plan.targets.length === 0 ||
    plan.targets.length > budget.maxNodes ||
    !Array.isArray(plan.edits) ||
    plan.edits.length === 0 ||
    plan.edits.length > budget.maxNodes
  ) {
    return invalidEntryPlan(
      'a composed container edit plan must contain a bounded non-empty edit set',
    )
  }
  const targets = new Map<string, SubjectEditTarget>()
  for (const target of plan.targets) {
    if (!isEntryTarget(target) || targets.has(target.targetId)) {
      return invalidEntryPlan('container entry edit plan contains a malformed or duplicate target')
    }
    targets.set(target.targetId, target)
  }
  const usedEntries = new Set<string>()
  const usedTargets = new Set<string>()
  let total = 0n
  const replacements = Object.freeze(
    plan.edits.map((edit: SourceEdit) => {
      if (
        !isRecord(edit) ||
        edit.operation !== 'replace' ||
        edit.range !== undefined ||
        !isSourceRef(edit.source) ||
        !isRecord(edit.payload) ||
        edit.payload.kind !== 'inline' ||
        !(edit.payload.bytes instanceof Uint8Array)
      ) {
        return invalidEntryPlan(
          'M4 container composition accepts only full-file inline replacements of issued entries',
        )
      }
      const target = targets.get(edit.targetId)
      const binding = bindings.get(edit.source.id)
      if (
        target === undefined ||
        binding === undefined ||
        !sameRef(edit.source, binding.ref) ||
        !sameRef(target.ownerSource, binding.ref) ||
        !revisionMatches(target, binding)
      ) {
        return invalidEntryPlan(
          'container entry edit does not match an adapter-issued ref/revision',
          {
            targetId: edit.targetId,
            sourceId: edit.source.id,
          },
        )
      }
      usedTargets.add(edit.targetId)
      if (usedEntries.has(binding.entryId)) {
        return invalidEntryPlan(`container entry ${binding.entryId} is replaced more than once`)
      }
      usedEntries.add(binding.entryId)
      const length = BigInt(edit.payload.bytes.byteLength)
      if (edit.payload.bytes.byteLength > budget.maxScalarBytes) {
        return invalidEntryPlan('a container entry replacement exceeds maxScalarBytes')
      }
      total += length
      if (total > budget.maxInputBytes) {
        return invalidEntryPlan('container entry replacements exceed maxInputBytes')
      }
      return Object.freeze({
        entryId: binding.entryId,
        expectedRevision: binding.providerRevision,
        bytesBase64: encodeBase64(edit.payload.bytes),
      })
    }),
  )
  if (usedTargets.size !== targets.size) {
    return invalidEntryPlan('container entry edit plan contains an unreferenced target')
  }
  return replacements
}

function composedOperations(options: {
  readonly semantic: OperationSession
  readonly semanticSpec: CodecContributionSpecV1Wire
  readonly parent: OperationSession
  readonly parentRevision: RevisionId
  readonly bindings: ReadonlyMap<string, EntryBinding>
  readonly budget: ResourceBudget
  readonly packHandlerId?: string
  readonly exportRawHandlerId?: string
  readonly dispose: () => Promise<void>
}): OperationSession {
  const operationByHandler = new Map(
    options.semanticSpec.operations.map(operation => [operation.handlerId, operation]),
  )
  return Object.freeze({
    async invoke(
      handlerId: string,
      input: JsonValue,
      invokeOptions?: Parameters<OperationSession['invoke']>[2],
    ): Promise<OperationResult> {
      throwIfAborted(invokeOptions?.signal)
      const declaration = operationByHandler.get(handlerId)
      if (declaration?.id === EXPORT_RAW) {
        if (options.exportRawHandlerId === undefined) {
          throw new ModkitError({
            code: 'x3.host/container-export-raw-unavailable',
            message: 'the retained container session publishes no available export.raw operation',
          })
        }
        return options.parent.invoke(options.exportRawHandlerId, input, invokeOptions)
      }
      const result = await options.semantic.invoke(handlerId, input, invokeOptions)
      throwIfAborted(invokeOptions?.signal)
      if (result.state !== 'ok' || result.output.kind !== 'edit-plan') return result
      if (
        declaration === undefined ||
        !declaration.mutatesSource ||
        !declaration.outputKinds?.includes('edit-plan')
      ) {
        return invalidEntryPlan(
          `handler ${handlerId} returned an edit plan without a declared mutating edit-plan operation`,
        )
      }
      if (options.packHandlerId === undefined) {
        throw new ModkitError({
          code: 'x3.host/container-pack-unavailable',
          message: 'the retained container session publishes no available container.pack operation',
        })
      }
      const replacements = replacementsFromPlan(
        result.output.plan,
        options.bindings,
        options.budget,
      )
      const request: ContainerPackInputV1 = Object.freeze({
        schemaVersion: 1,
        expectedContainerRevision: options.parentRevision,
        replacements,
        intent: Object.freeze({
          operation: declaration?.id ?? handlerId,
          input,
          semanticPlanId: result.output.plan.planId,
        }),
      })
      throwIfAborted(invokeOptions?.signal)
      const packed = await options.parent.invoke(
        options.packHandlerId,
        request as unknown as JsonValue,
        invokeOptions,
      )
      throwIfAborted(invokeOptions?.signal)
      if (packed.state === 'ok' && packed.output.kind !== 'edit-plan') {
        throw new ModkitError({
          code: 'x3.host/container-pack-result-invalid',
          message: 'container.pack must return the outer container as an edit-plan',
        })
      }
      return packed
    },
    dispose: options.dispose,
  })
}

/**
 * Retain a container namespace and expose only its entries as an ArtifactNamespaceSource.
 * The caller owns the parent session; `dispose` releases entry refs and then the namespace lease.
 */
export async function createContainerNamespaceComposition(
  options: CreateContainerNamespaceCompositionOptions,
): Promise<ContainerNamespaceComposition> {
  throwIfAborted(options.signal)
  const descriptor = await options.parent.descriptor()
  throwIfAborted(options.signal)
  const extractHandlerId = operationHandler(descriptor, CONTAINER_EXTRACT)
  if (extractHandlerId === undefined) {
    throw new ModkitError({
      code: 'x3.host/container-extract-unavailable',
      message: 'a composed container must publish an available container.extract operation',
    })
  }
  if (
    !descriptor.dataSources.some(
      item => item.contract === NAMESPACE_ENTRY_SOURCE && item.major === 1,
    )
  ) {
    throw new ModkitError({
      code: 'x3.host/container-namespace-unavailable',
      message: `a composed container must publish ${NAMESPACE_ENTRY_SOURCE}@1`,
    })
  }
  const namespaceLease = await options.parent.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
  try {
    throwIfAborted(options.signal)
  } catch (error) {
    await namespaceLease.release()
    throw error
  }
  const namespace = namespaceLease.value as NamespaceEntrySource
  const parentOperations = options.parent.operations()
  const bindings = new Map<string, EntryBinding>()
  const outstanding = new Set<() => Promise<void>>()
  let disposed = false
  let exposedEntries = 0
  let extractedBytes = 0n

  const ensureLive = (signal?: AbortSignal): void => {
    throwIfAborted(signal)
    if (disposed) {
      throw new ModkitError({
        code: 'x3.host/container-composition-disposed',
        message: 'container namespace composition is disposed',
      })
    }
  }

  const validateEntry = (entry: NamespaceEntry, requestedPrefix: string): NamespaceEntry => {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      entry.id === '' ||
      typeof entry.path !== 'string' ||
      (entry.kind !== 'file' && entry.kind !== 'directory')
    ) {
      throw new ModkitError({
        code: 'x3.host/container-namespace-invalid',
        message: 'container namespace returned a malformed entry',
      })
    }
    const normalized = normalizePath(entry.path, false)
    if (
      requestedPrefix !== '' &&
      normalized !== requestedPrefix &&
      !normalized.startsWith(`${requestedPrefix}/`)
    ) {
      throw new ModkitError({
        code: 'x3.host/container-namespace-invalid',
        message: `container namespace entry «${normalized}» escaped requested prefix «${requestedPrefix}»`,
      })
    }
    exposedEntries += 1
    if (exposedEntries > options.budget.maxNodes) {
      throw new ModkitError({
        code: 'x3.host/container-namespace-entry-budget-exceeded',
        message: `container namespace exceeded its ${options.budget.maxNodes}-entry budget`,
      })
    }
    return normalized === entry.path ? entry : Object.freeze({ ...entry, path: normalized })
  }

  const pages = async function* (
    prefix: string,
    signal?: AbortSignal,
  ): AsyncIterable<NamespaceEntry> {
    let cursor: string | undefined
    const seenCursors = new Set<string>()
    do {
      ensureLive(signal)
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new ModkitError({
            code: 'x3.host/container-namespace-cursor-repeated',
            message: 'container namespace repeated a paging cursor',
          })
        }
        seenCursors.add(cursor)
      }
      const page = await namespace.list(
        prefix,
        cursor === undefined ? { limit: PAGE_LIMIT } : { cursor, limit: PAGE_LIMIT },
        signal,
      )
      ensureLive(signal)
      if (
        page === null ||
        typeof page !== 'object' ||
        !Array.isArray(page.items) ||
        page.items.length > PAGE_LIMIT ||
        (page.nextCursor !== undefined &&
          (typeof page.nextCursor !== 'string' || page.nextCursor === ''))
      ) {
        throw new ModkitError({
          code: 'x3.host/container-namespace-page-invalid',
          message: 'container namespace returned a malformed or over-limit page',
        })
      }
      for (const entry of page.items) {
        ensureLive(signal)
        yield validateEntry(entry, prefix)
      }
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

  const lookup = async (
    path: string,
    signal?: AbortSignal,
  ): Promise<
    { readonly kind: 'file'; readonly entry: NamespaceEntry } | { readonly kind: 'directory' }
  > => {
    ensureLive(signal)
    const page = await namespace.list(path, { limit: 1 }, signal)
    ensureLive(signal)
    if (
      page === null ||
      typeof page !== 'object' ||
      !Array.isArray(page.items) ||
      page.items.length > 1
    ) {
      throw new ModkitError({
        code: 'x3.host/container-namespace-page-invalid',
        message: 'container namespace returned a malformed exact-lookup page',
      })
    }
    const raw = page.items[0]
    if (raw === undefined) {
      throw new ModkitError({
        code: ENTRY_NOT_FOUND,
        message: `namespace entry «${path}» does not exist`,
        context: { path },
      })
    }
    const entry = validateEntry(raw, path)
    if (entry.path === path) {
      return entry.kind === 'file' ? { kind: 'file', entry } : { kind: 'directory' }
    }
    if (entry.path.startsWith(`${path}/`)) return { kind: 'directory' }
    throw new ModkitError({
      code: ENTRY_NOT_FOUND,
      message: `namespace entry «${path}» does not exist`,
      context: { path },
    })
  }

  const sourceAt = (
    prefix: string,
    ref: AssetSourceRef,
    revision: RevisionId,
  ): ArtifactNamespaceSource =>
    Object.freeze({
      kind: 'namespace' as const,
      ref,
      revision,
      async openNamespace(signal?: AbortSignal): Promise<Lease<AssetNamespace>> {
        ensureLive(signal)
        const assetNamespace: AssetNamespace = Object.freeze({
          revision,
          async *list(requestedPrefix: string, listSignal?: AbortSignal) {
            ensureLive(listSignal)
            const relativePrefix = normalizePath(requestedPrefix, true)
            const absolutePrefix =
              prefix === ''
                ? relativePrefix
                : relativePrefix === ''
                  ? prefix
                  : `${prefix}/${relativePrefix}`
            const children = new Map<string, AssetNamespaceEntry>()
            for await (const entry of pages(absolutePrefix, listSignal)) {
              const suffix =
                absolutePrefix === ''
                  ? entry.path
                  : entry.path === absolutePrefix
                    ? ''
                    : entry.path.slice(absolutePrefix.length + 1)
              if (suffix === '') continue
              const [name] = suffix.split('/')
              if (name === undefined || name === '') continue
              const childPath = relativePrefix === '' ? name : `${relativePrefix}/${name}`
              const nested = suffix.includes('/')
              const value = Object.freeze({
                path: childPath,
                kind: nested ? ('directory' as const) : entry.kind,
                ...(!nested && entry.kind === 'file' && entry.size !== undefined
                  ? { size: entry.size }
                  : {}),
              })
              const prior = children.get(childPath)
              if (prior !== undefined && prior.kind !== value.kind) {
                throw new ModkitError({
                  code: 'x3.host/container-namespace-invalid',
                  message: `container namespace path «${childPath}» is both a file and a directory`,
                })
              }
              children.set(childPath, value)
            }
            for (const child of [...children.values()].sort((left, right) =>
              left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
            )) {
              ensureLive(listSignal)
              yield child
            }
          },
          async open(
            requestedPath: string,
            openSignal?: AbortSignal,
          ): Promise<Lease<ArtifactSource>> {
            ensureLive(openSignal)
            const relativePath = normalizePath(requestedPath, false)
            const absolutePath = prefix === '' ? relativePath : `${prefix}/${relativePath}`
            const found = await lookup(absolutePath, openSignal)
            const refForEntry = childRef(options.root, absolutePath)
            if (found.kind === 'directory') {
              return Object.freeze({
                value: sourceAt(
                  absolutePath,
                  refForEntry,
                  revisionIdFromRef({
                    kind: 'provider-token',
                    value: `${String(options.revision)}!directory:${absolutePath}`,
                  }),
                ),
                release: async () => undefined,
              })
            }
            const refLease = await namespace.openEntry(found.entry.id, openSignal)
            let released = false
            const release = async (): Promise<void> => {
              if (released) return
              released = true
              outstanding.delete(release)
              await refLease.release()
            }
            outstanding.add(release)
            try {
              ensureLive(openSignal)
              if (!sameRef(refLease.value, refForEntry)) {
                // Preserve the provider's opaque ref exactly; only its parent chain is host checked.
                if (
                  refLease.value.parentIds === undefined ||
                  !refLease.value.parentIds.includes(options.root.id)
                ) {
                  throw new ModkitError({
                    code: 'x3.host/container-entry-ref-invalid',
                    message: `container entry «${absolutePath}» is not parented by the outer source`,
                  })
                }
              }
              const invoked = await parentOperations.invoke(
                extractHandlerId,
                { entryId: found.entry.id },
                openSignal === undefined ? {} : { signal: openSignal },
              )
              ensureLive(openSignal)
              if (invoked.state !== 'ok' || invoked.output.kind !== 'bytes') {
                throw new ModkitError({
                  code: 'x3.host/container-entry-unreadable',
                  message: `container refused to extract entry «${absolutePath}»`,
                })
              }
              const bytes = invoked.output.value
              if (bytes.byteLength > options.budget.maxScalarBytes) {
                throw new ModkitError({
                  code: 'x3.host/container-entry-scalar-budget-exceeded',
                  message: `container entry «${absolutePath}» exceeds maxScalarBytes`,
                })
              }
              extractedBytes += BigInt(bytes.byteLength)
              if (extractedBytes > options.budget.maxInputBytes) {
                throw new ModkitError({
                  code: 'x3.host/container-entry-byte-budget-exceeded',
                  message: 'container composition exceeded maxInputBytes while extracting entries',
                })
              }
              const sourceRevision = containerEntryRevision(
                options.revision,
                found.entry.id,
                bytes.byteLength,
              )
              const ref = refLease.value
              const prior = bindings.get(ref.id)
              if (
                prior !== undefined &&
                (prior.entryId !== found.entry.id || prior.sourceRevision !== sourceRevision)
              ) {
                throw new ModkitError({
                  code: 'x3.host/container-entry-ref-collision',
                  message: `container reused entry ref ${ref.id} for different content`,
                })
              }
              bindings.set(
                ref.id,
                Object.freeze({
                  entryId: found.entry.id,
                  path: absolutePath,
                  ref,
                  providerRevision: found.entry.revision,
                  sourceRevision,
                }),
              )
              return Object.freeze({
                value: containerEntrySource(ref, sourceRevision, bytes),
                release,
              })
            } catch (error) {
              await release()
              throw error
            }
          },
        })
        return Object.freeze({ value: assetNamespace, release: async () => undefined })
      },
    })

  const source = sourceAt('', options.root, options.revision)
  const packHandlerId = operationHandler(descriptor, CONTAINER_PACK)
  const exportRawHandlerId = operationHandler(descriptor, EXPORT_RAW)

  const composition: ContainerNamespaceComposition = Object.freeze({
    source,
    descriptor,
    ...(packHandlerId === undefined ? {} : { packHandlerId }),
    ...(exportRawHandlerId === undefined ? {} : { exportRawHandlerId }),
    wrapSession(
      semantic: AssetSession,
      semanticSpec: CodecContributionSpecV1Wire,
      parent: AssetSession,
    ): AssetSession {
      let sessionDisposed = false
      const dispose = async (): Promise<void> => {
        if (sessionDisposed) return
        sessionDisposed = true
        let firstError: unknown
        try {
          await semantic.dispose()
        } catch (error) {
          firstError = error
        }
        try {
          await composition.dispose()
        } catch (error) {
          firstError ??= error
        }
        try {
          await parent.dispose()
        } catch (error) {
          firstError ??= error
        }
        if (firstError !== undefined) throw firstError
      }
      const operations = composedOperations({
        semantic: semantic.operations(),
        semanticSpec,
        parent: parent.operations(),
        parentRevision: parent.revision,
        bindings,
        budget: options.budget,
        dispose,
        ...(packHandlerId === undefined ? {} : { packHandlerId }),
        ...(exportRawHandlerId === undefined ? {} : { exportRawHandlerId }),
      })
      return Object.freeze({
        revision: semantic.revision,
        state: () => semantic.state(),
        descriptor: () => semantic.descriptor(),
        dataSource: semantic.dataSource.bind(semantic) as AssetSession['dataSource'],
        operations: () => operations,
        events: (signal?: AbortSignal) => semantic.events(signal),
        dispose,
      })
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      let firstError: unknown
      for (const release of [...outstanding].reverse()) {
        try {
          await release()
        } catch (error) {
          firstError ??= error
        }
      }
      try {
        await namespaceLease.release()
      } catch (error) {
        firstError ??= error
      }
      if (firstError !== undefined) throw firstError
    },
  })
  return composition
}
