/**
 * ADR-HOST-002 §2/§3 — the standard writer definition, its matcher profile, the standard writer
 * surface in the host registry, and the one operation-scoped permission rule shared by the
 * resolver-facing offer projection, the gate and dispatch.
 */
import { describe, expect, it } from 'vitest'
import { contractId } from '@modkit/core'
import {
  STANDARD_EDITING_SURFACES,
  WRITER_CONTRACT_ID,
  WRITER_SURFACE,
  activationRequiredPermissionClasses,
  operationScopedPermissionClasses,
  type OperationPermissionDeclaration,
  writerOfferSatisfies,
  writerSelectionKey,
} from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  registerStandardEditingDefinitions,
  STANDARD_EDITING_OWNER,
  WRITER_FACET_MATCHER,
} from '@modkit/host'
import { createStandardSurfaceRegistry } from '@modkit/host/execution'

const request = {
  formatId: 'png',
  representationId: 'source',
  mutationMode: 'mutate',
  minimumRoundTrip: 'semantic',
} as const
const offer = {
  ...request,
  providerId: 'org.example/w',
  fidelityEvidenceId: 'e1',
  minimumRoundTrip: 'byte-identical',
} as const

describe('writer facet rule and matcher profile', () => {
  it('same format/representation, mutate serves export-only, stronger round trip satisfies weaker', () => {
    expect(writerOfferSatisfies(request, offer)).toBe(true)
    expect(writerOfferSatisfies({ ...request, mutationMode: 'export-only' }, offer)).toBe(true)
    expect(writerOfferSatisfies(request, { ...offer, mutationMode: 'export-only' as const })).toBe(
      false,
    )
    expect(writerOfferSatisfies(request, { ...offer, minimumRoundTrip: 'lossy' })).toBe(false)
    expect(writerOfferSatisfies({ ...request, formatId: 'bmp' }, offer)).toBe(false)
    expect(writerSelectionKey(request)).toBe('writer:png:source:mutate:semantic')
  })

  it('the host matcher wraps the rule and refuses incomplete facets as invalid', async () => {
    const context = {
      contract: contractId(WRITER_CONTRACT_ID),
      major: 1,
      ownerExtensionId: 'org.example/x',
    }
    expect(
      await WRITER_FACET_MATCHER.match(
        { ...context, offerFacet: offer, requestFacet: request },
        undefined,
      ),
    ).toEqual({ state: 'match', selectionKey: 'writer:png:source:mutate:semantic' })
    expect(
      await WRITER_FACET_MATCHER.match(
        { ...context, offerFacet: offer, requestFacet: { ...request, formatId: 'bmp' } },
        undefined,
      ),
    ).toEqual({ state: 'no-match' })
    const invalid = await WRITER_FACET_MATCHER.match(
      { ...context, offerFacet: { formatId: 'png' }, requestFacet: request },
      undefined,
    )
    expect(invalid.state).toBe('invalid')
  })

  it('the bundled registry carries the matcher and the standard definition registers with the writer surface', async () => {
    const registry = createBundledServiceDefinitionRegistry()
    expect(await registerStandardEditingDefinitions(registry)).toEqual({ state: 'committed' })
    const registration = registry.lookup(contractId(WRITER_CONTRACT_ID), 1)
    expect(registration?.provenance.ownerExtensionId).toBe(STANDARD_EDITING_OWNER)
    expect(registration?.surface?.methods).toHaveProperty('validate')
    expect(registration?.surface?.methods).toHaveProperty('plan')
    expect(registration?.surface?.fields).toEqual(['identity', 'offer'])
    // the SDK table and the registry agree, and the host's standard surface set includes it
    expect(STANDARD_EDITING_SURFACES[WRITER_CONTRACT_ID]).toBe(WRITER_SURFACE)
    const surfaces = createStandardSurfaceRegistry()
    expect(surfaces.surfaceFor(WRITER_CONTRACT_ID, 1)?.fields).toEqual(['identity', 'offer'])
  })
})

describe('operation-scoped permission classes (one rule, three consumers)', () => {
  const operations: readonly OperationPermissionDeclaration[] = [
    { mutatesSource: false, requiredPermissions: ['read-source'] },
    { mutatesSource: true, requiredPermissions: ['read-source'] },
    { mutatesSource: false, requiredPermissions: ['read-source', 'network'] },
  ]
  it('collects what operations need, never read-source, and leaves activation requirements', () => {
    expect([...operationScopedPermissionClasses(operations)].sort()).toEqual([
      'network',
      'write-source',
    ])
    expect(
      activationRequiredPermissionClasses(
        ['read-source', 'write-source', 'network', 'filesystem-read'],
        operations,
      ),
    ).toEqual(['read-source', 'filesystem-read'])
    expect(activationRequiredPermissionClasses(['read-source', 'write-source'], undefined)).toEqual(
      ['read-source', 'write-source'],
    )
  })
})
