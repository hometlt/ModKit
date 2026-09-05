/** Public application route for the standard `container.pack` operation. */

import { ModkitError, throwIfAborted } from '@modkit/core'
import type {
  AssetEditPlan,
  ContainerPackInputV1,
  JsonValue,
  OperationResult,
  Progress,
} from '@modkit/sdk'
import type { OpenedSubject } from './subject-open.js'
import { editPlanFromOperationForDescriptor } from './subject-editing.js'

export interface InvokeContainerPackOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: Progress) => void
}

export type ContainerPackResult =
  | {
      readonly state: 'ok'
      readonly output: { readonly kind: 'edit-plan'; readonly plan: AssetEditPlan }
      readonly diagnostics: Extract<OperationResult, { readonly state: 'ok' }>['diagnostics']
    }
  | Exclude<OperationResult, { readonly state: 'ok' }>

function invalidInput(message: string): never {
  throw new ModkitError({ code: 'x3.host/container-pack-input-invalid', message })
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function canonicalBase64(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  )
}

/** Validate only the standard wire shape; provider-specific path and budget policy stays in the codec. */
function validateInput(input: ContainerPackInputV1): void {
  const value = record(input)
  if (
    value === undefined ||
    value['schemaVersion'] !== 1 ||
    typeof value['expectedContainerRevision'] !== 'string' ||
    value['expectedContainerRevision'] === ''
  ) {
    invalidInput('container.pack requires schemaVersion 1 and an expected container revision')
  }
  if (value['mode'] === 'create') {
    if (
      Object.keys(value).some(
        key =>
          key !== 'schemaVersion' &&
          key !== 'mode' &&
          key !== 'expectedContainerRevision' &&
          key !== 'files',
      )
    ) {
      invalidInput('container.pack create input contains unsupported fields')
    }
    if (value['replacements'] !== undefined || value['intent'] !== undefined) {
      invalidInput('container.pack create input cannot contain replacements or replacement intent')
    }
    const files = value['files']
    if (!Array.isArray(files)) invalidInput('container.pack create input requires a files array')
    for (const [index, candidate] of files.entries()) {
      const file = record(candidate)
      if (
        file === undefined ||
        Object.keys(file).some(key => key !== 'name' && key !== 'bytesBase64') ||
        typeof file['name'] !== 'string' ||
        file['name'] === '' ||
        !canonicalBase64(file['bytesBase64'])
      ) {
        invalidInput(`container.pack create file ${index} is not a named canonical-base64 payload`)
      }
    }
    return
  }
  if (value['mode'] !== undefined && value['mode'] !== 'replace') {
    invalidInput(`container.pack mode ${String(value['mode'])} is not supported by version 1`)
  }
  if (value['files'] !== undefined) {
    invalidInput('container.pack replacement input cannot contain creation files')
  }
  if (
    Object.keys(value).some(
      key =>
        key !== 'schemaVersion' &&
        key !== 'mode' &&
        key !== 'expectedContainerRevision' &&
        key !== 'replacements' &&
        key !== 'intent',
    )
  ) {
    invalidInput('container.pack replacement input contains unsupported fields')
  }
  const replacements = value['replacements']
  if (!Array.isArray(replacements) || replacements.length === 0) {
    invalidInput('container.pack replacement input requires at least one replacement')
  }
  for (const [index, candidate] of replacements.entries()) {
    const replacement = record(candidate)
    if (
      replacement === undefined ||
      typeof replacement['entryId'] !== 'string' ||
      replacement['entryId'] === '' ||
      typeof replacement['expectedRevision'] !== 'string' ||
      replacement['expectedRevision'] === '' ||
      !canonicalBase64(replacement['bytesBase64'])
    ) {
      invalidInput(`container.pack replacement ${index} is malformed`)
    }
  }
}

/**
 * Invoke `container.pack` by its standard operation id on a subject opened through inventory.
 * Applications never need a provider-private handler id or module export.
 */
export async function invokeContainerPack(
  opened: Pick<OpenedSubject, 'descriptor' | 'session'>,
  input: ContainerPackInputV1,
  options: InvokeContainerPackOptions = {},
): Promise<ContainerPackResult> {
  throwIfAborted(options.signal)
  validateInput(input)
  if (input.expectedContainerRevision !== opened.descriptor.revision) {
    throw new ModkitError({
      code: 'x3.host/container-pack-stale-revision',
      message: 'container.pack input does not name the opened subject revision',
      context: {
        expected: input.expectedContainerRevision,
        opened: opened.descriptor.revision,
      },
    })
  }
  const operation = opened.descriptor.operations.find(item => item.id === 'container.pack')
  if (operation === undefined || operation.state !== 'available') {
    throw new ModkitError({
      code: 'x3.host/container-pack-unavailable',
      message: 'the opened subject publishes no available container.pack operation',
    })
  }
  const result = await opened.session.operations().invoke(
    operation.handlerId,
    input as unknown as JsonValue,
    options,
  )
  throwIfAborted(options.signal)
  if (result.state === 'ok') {
    if (result.output.kind !== 'edit-plan') {
      throw new ModkitError({
        code: 'x3.host/container-pack-result-invalid',
        message: 'container.pack must return an outer edit-plan',
      })
    }
    const plan = editPlanFromOperationForDescriptor(opened.descriptor, result.output)
    return Object.freeze({
      state: 'ok',
      output: Object.freeze({ kind: 'edit-plan', plan }),
      diagnostics: result.diagnostics,
    })
  }
  return result as ContainerPackResult
}
