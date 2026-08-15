import { throwIfAborted } from '@modkitx-x3/core'
import {
  V1_PROJECTION_UNAVAILABLE_CODE,
  type AnyDescriptor,
  type V1DescriptorProjectionPort,
  type V1DescriptorProjectionResult,
  type V1ProjectionUnavailableDiagnostic,
  type V1ProjectionCatalogContext,
  type V1ViewerContributionDescriptor,
} from '@modkitx-x3/sdk'

function unavailable(message: string): V1DescriptorProjectionResult {
  const item = Object.freeze({
    id: 'v1-projection-unavailable',
    category: 'dependency',
    code: V1_PROJECTION_UNAVAILABLE_CODE,
    severity: 'error',
    message,
  }) as V1ProjectionUnavailableDiagnostic
  return { state: 'unavailable', diagnostics: [item] }
}

function snapshotContribution(
  item: V1ViewerContributionDescriptor,
): V1ViewerContributionDescriptor {
  return Object.freeze({
    ...item,
    ...(item.requiresTraits === undefined
      ? {}
      : {
          requiresTraits: Object.freeze(
            item.requiresTraits.map(requirement =>
              Object.freeze({
                ...requirement,
                ...(requirement.states === undefined
                  ? {}
                  : { states: Object.freeze([...requirement.states]) }),
              }),
            ),
          ),
        }),
    ...(item.requiresOperations === undefined
      ? {}
      : { requiresOperations: Object.freeze([...item.requiresOperations]) }),
    ...(item.hosts === undefined ? {} : { hosts: Object.freeze([...item.hosts]) }),
    ...(item.conflicts === undefined ? {} : { conflicts: Object.freeze([...item.conflicts]) }),
  })
}

/** Host-local, data-only v2→v1 compatibility adapter. */
export function createV1DescriptorProjectionPort(): V1DescriptorProjectionPort {
  return Object.freeze({
    async project(
      descriptor: AnyDescriptor,
      catalog: V1ProjectionCatalogContext | undefined,
      signal?: AbortSignal,
    ) {
      throwIfAborted(signal)
      if (catalog === undefined) {
        return unavailable('viewer catalog evaluation is required for a v1 projection')
      }
      if (
        catalog.subjectUri !== descriptor.subjectUri ||
        catalog.revision !== descriptor.revision
      ) {
        return unavailable('viewer catalog evaluation belongs to another subject revision')
      }
      const contributions = Object.freeze(catalog.compatibleContributions.map(snapshotContribution))
      throwIfAborted(signal)
      return {
        state: 'projected',
        projection: Object.freeze({
          schemaVersion: 1,
          contributions,
          catalogRevision: catalog.catalogRevision,
          persistable: false,
        }),
      } satisfies V1DescriptorProjectionResult
    },
  })
}
