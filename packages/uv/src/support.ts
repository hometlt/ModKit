import type { ChangeSet, Lease, SourceEdit, Writer, WriterModule } from '@modkit/sdk'

type WriterPlan = Awaited<ReturnType<Writer['plan']>>

interface DefineWriterOptions
  extends Omit<Writer['identity'], 'providerVersion'>, Omit<Writer['offer'], 'mutationMode'> {
  readonly providerVersion?: Writer['identity']['providerVersion']
  readonly mutationMode?: Writer['offer']['mutationMode']
  readonly offerId: Parameters<WriterModule['createProvider']>[0]['offerId']
  readonly fidelity: WriterPlan['fidelity']
  readonly validate?: Writer['validate']
  readonly planEdits?: (...args: Parameters<Writer['plan']>) => Promise<WriterPlan['edits']>
  readonly plan?: Writer['plan']
}
/** Small ABI helpers owned by the built-in UV module, with no extension-side dependencies. */
export function simpleLease<T>(value: T): Lease<T> & { isReleased(): boolean } {
  let released = false
  return Object.freeze({
    value,
    async release() {
      released = true
    },
    isReleased: () => released,
  })
}

/** Build the provider module for one `common.edit/writer@1` implementation. */
export function defineWriter({
  providerId,
  providerVersion = '1.0.0',
  artifactDigest,
  offerId,
  formatId,
  representationId,
  mutationMode = 'mutate',
  minimumRoundTrip,
  fidelityEvidenceId,
  fidelity,
  validate,
  planEdits,
  plan,
}: DefineWriterOptions): WriterModule {
  const identity = Object.freeze({
    providerId,
    providerVersion,
    artifactDigest,
    formatId,
    representationId,
  })
  const offer = Object.freeze({
    providerId,
    fidelityEvidenceId,
    formatId,
    representationId,
    mutationMode,
    minimumRoundTrip,
  })
  const writer = Object.freeze<Writer>({
    identity,
    offer,
    async validate(change, signal) {
      if (validate !== undefined) return validate(change, signal)
      return { valid: change.targets.length > 0 && change.edits.length > 0, diagnostics: [] }
    },
    async plan(change, signal) {
      if (plan !== undefined) return plan(change, signal)
      const edits = await (
        planEdits as (change: ChangeSet, signal?: AbortSignal) => Promise<readonly SourceEdit[]>
      )(change, signal)
      return Object.freeze({
        planId: `${providerId}:${change.targets.map(target => target.targetId).join('+')}`,
        targets: change.targets,
        edits,
        semantics: Object.freeze({ mutationMode, minimumGuarantee: 'atomic' }),
        fidelity,
        diagnostics: Object.freeze([]),
      })
    },
  })
  return Object.freeze<WriterModule>({
    abiVersion: 1,
    provides: Object.freeze(['common.edit/writer']),
    async createProvider(selection) {
      if (selection.offerId !== offerId) {
        throw new TypeError(`unknown writer offer ${selection.offerId}`)
      }
      return simpleLease(writer)
    },
  })
}
