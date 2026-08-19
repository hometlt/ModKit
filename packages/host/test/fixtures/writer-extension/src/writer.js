// ADR-HOST-002 Path B fixture: a writer provider that validates and passes a ChangeSet through
// as the plan — the boundary, the facet resolution and the host commit are what it proves.
// Provider modules expose the ABI as named exports (`abiVersion`, `provides`, `createProvider`).
// Written by hand (no kit import): the worker resolves bare specifiers from the artifact's own
// location, and this fixture lives under packages/host/test, where the kit is not a dependency.

const identity = Object.freeze({
  providerId: 'org.example/png-passthrough-writer',
  providerVersion: '1.0.0',
  artifactDigest: 'sha256:png-passthrough-writer-fixture',
  formatId: 'png',
  representationId: 'source',
})

const offer = Object.freeze({
  providerId: identity.providerId,
  fidelityEvidenceId: 'png-passthrough-v1',
  formatId: 'png',
  representationId: 'source',
  mutationMode: 'mutate',
  minimumRoundTrip: 'byte-identical',
})

const writer = Object.freeze({
  identity,
  offer,
  async validate(change) {
    const byteRanges = change.edits.every(
      edit =>
        edit.operation === 'replace' && (edit.range === undefined || edit.range.kind === 'bytes'),
    )
    return {
      valid: change.targets.length > 0 && change.edits.length > 0 && byteRanges,
      diagnostics: byteRanges
        ? []
        : [
            {
              severity: 'error',
              code: 'x3.example/writer-byte-edits-only',
              message: 'byte edits only',
            },
          ],
    }
  },
  async plan(change) {
    return {
      planId: `png-passthrough:${change.targets.map(target => target.targetId).join('+')}`,
      targets: change.targets,
      edits: change.edits,
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    }
  },
})

export const abiVersion = 1
export const provides = Object.freeze(['common.edit/writer'])
export async function createProvider(selection) {
  if (selection.offerId !== 'png-source-byte-identical') {
    throw new TypeError(`unknown writer offer ${selection.offerId}`)
  }
  return {
    value: writer,
    async release() {
      // nothing leased beyond the frozen writer object
    },
  }
}
