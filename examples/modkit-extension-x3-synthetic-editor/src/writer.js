const identity = Object.freeze({
  providerId: 'org.example/synthetic-text-writer',
  providerVersion: '1.0.0',
  artifactDigest: 'sha256:synthetic-text-writer-v1',
  formatId: 'text',
  representationId: 'source',
})

export const writer = Object.freeze({
  identity,
  offer: Object.freeze({
    providerId: identity.providerId,
    fidelityEvidenceId: 'synthetic-text-v1',
    formatId: identity.formatId,
    representationId: identity.representationId,
    mutationMode: 'mutate',
    minimumRoundTrip: 'byte-identical',
  }),
  async validate(change) {
    return { valid: change.targets.length > 0 && change.edits.length > 0, diagnostics: [] }
  },
  async plan(change) {
    return {
      planId: 'synthetic-text-plan',
      targets: change.targets,
      edits: change.edits,
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'best-effort' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    }
  },
})

export const syntheticWriterModule = Object.freeze({
  abiVersion: 1,
  async createProvider(selection) {
    if (selection.offerId !== 'text-byte-identical') throw new TypeError('unknown writer offer')
    return {
      value: writer,
      async release() {
        return undefined
      },
    }
  },
})

export default syntheticWriterModule
