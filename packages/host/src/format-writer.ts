/**
 * Resolve the format's own writer for an opened subject — Path B, made reachable.
 *
 * Nine writers ship (`common.edit/writer@1`: eight text formats and a PNG encoder), every one
 * proven end to end at the host level, and until now no application resolved any of them: every
 * product save went through `createRawWriter`, a literal byte splicer. The practical difference is
 * not subtle — a raw writer accepts a whole-source replace that corrupts a JSON file, because
 * "these bytes at this range" is the entire contract; the format writer refuses it at `propose`,
 * which is the moment a user can still do something about it.
 *
 * This module is the resolution recipe the proofs perform, as one call: facet from the opened
 * subject's own identity (`descriptor.identity.formatId`), `representationId: 'source'` and
 * `minimumRoundTrip: 'byte-identical'` by default (the shape a text editor needs; an encoder like
 * the PNG writer serves a different representation at `semantic` and is requested explicitly),
 * and an *outcome that is data*: the writer with its lease when one offers, or `undefined` with a
 * diagnostic naming exactly what was asked and not offered — so a host can fall back to the raw
 * writer without pretending the fallback is the same thing.
 */

import type { Diagnostic } from '@modkitx-x3/core'
import type { PermissionGrant, ResourceBudget, Writer } from '@modkitx-x3/sdk'
import { createHostServiceResolver } from './service-leases.js'
import type { SubjectServices } from './subject-services.js'
import type { OpenedSubject } from './subject-open.js'

export interface FormatWriterRequest {
  /** The composed services the subject was opened through (inventory, target, backends, defs). */
  readonly services: Pick<
    SubjectServices,
    'inventory' | 'target' | 'executionBackends' | 'serviceDefinitions'
  >
  readonly opened: OpenedSubject
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  /** Default `'source'` — the representation a text editor edits. */
  readonly representationId?: string
  /** Default `'byte-identical'`. */
  readonly minimumRoundTrip?: 'byte-identical' | 'semantic' | 'lossy'
  readonly mutationMode?: 'mutate' | 'export-only'
}

export interface FormatWriterResolution {
  /** The format's writer, when one offers the requested facet. */
  readonly writer?: Writer
  /** Release with the subject; absent when no writer resolved. */
  readonly release?: () => Promise<void>
  /** What was asked, what answered, or why nothing did — for the host's diagnostic stream. */
  readonly diagnostics: readonly Diagnostic[]
}

const diagnostic = (
  severity: Diagnostic['severity'],
  code: string,
  message: string,
): Diagnostic => ({ severity, code, message, path: [] })

export async function resolveFormatWriter(
  request: FormatWriterRequest,
): Promise<FormatWriterResolution> {
  const identity = (
    request.opened.descriptor as unknown as {
      readonly identity?: { readonly formatId?: unknown }
    }
  ).identity
  const formatId = typeof identity?.formatId === 'string' ? identity.formatId : undefined
  if (formatId === undefined) {
    return {
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/format-writer-unavailable',
          'the subject names no format (unresolved or built-in), so no format writer can be asked for',
        ),
      ],
    }
  }
  if (request.services.serviceDefinitions === undefined) {
    return {
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/format-writer-unavailable',
          'this host registered no service-contract definitions, so writers cannot be resolved',
        ),
      ],
    }
  }
  const facet = {
    formatId,
    representationId: request.representationId ?? 'source',
    mutationMode: request.mutationMode ?? ('mutate' as const),
    minimumRoundTrip: request.minimumRoundTrip ?? ('byte-identical' as const),
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions: request.services.serviceDefinitions,
    grant: request.grant,
    budgets: request.budgets,
  })
  try {
    const lease = await resolver.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet,
    })
    const writer = lease.value as Writer
    return {
      writer,
      release: () => lease.release(),
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/format-writer-selected',
          `«${writer.offer.providerId}» writes ${facet.formatId}/${facet.representationId} at ${writer.offer.minimumRoundTrip}`,
        ),
      ],
    }
  } catch (error) {
    /*
     * Unresolved is an answer, not a failure: most formats have no writer yet, and the caller's
     * fallback (the raw byte writer) is legitimate — it just must not be mistaken for this.
     */
    return {
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/format-writer-unresolved',
          `no writer offers ${facet.formatId}/${facet.representationId} at ${facet.minimumRoundTrip} ` +
            `(${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}
