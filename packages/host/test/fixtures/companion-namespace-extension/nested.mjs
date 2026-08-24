/**
 * The shared body of the two nested-namespace fixture codecs.
 *
 * Same discipline as the sibling fixture, one archive deeper: this codec declares that it needs a
 * texture, and then reads whatever the host bound. It has no filesystem access, no container
 * handle, no entry id and no idea that it is inside a BIG at all — which is the point. If the
 * archive backend were quietly falling back to disk, nothing here would change, so the test that
 * proves it does not is a host-side counter, not a codec-side assertion.
 */

import { createInspectionCodec } from '../../../../../extensions/codec-kit/codec-kit/src/index.js'

/**
 * @param {{
 *   id: string
 *   requirement: import('@modkitx-x3/sdk').AssetInputRequirement
 * }} options
 */
export const nestedCompanionCodec = options =>
  createInspectionCodec({
    id: options.id,
    format: { id: options.id.split('/')[1], label: 'Nested namespace companion fixture' },
    async detect(bytes) {
      // the fixture payload is the repository's synthetic Westwood W3D; four leading zero bytes are
      // its first chunk id, which is all the identity this fixture needs
      return bytes.byteLength >= 8 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0
        ? { confidence: 0.99, kind: 'magic', note: 'synthetic W3D chunk header' }
        : { confidence: 0, kind: 'magic', note: 'not the fixture payload' }
    },
    async planInput() {
      return Object.freeze({
        originKind: 'bundle',
        candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
        requirements: Object.freeze([Object.freeze(options.requirement)]),
      })
    },
    async inspect(bytes, context) {
      const bound = context.input.bindingsFor(options.requirement.id)
      let skin
      if (bound.length > 0) {
        const lease = await context.input.openBinding(bound[0].bindingId, context.signal)
        try {
          if (lease.value.kind !== 'bytes') throw new TypeError('companion must be a byte source')
          const size = Number(lease.value.size ?? 0n)
          skin = Array.from(await lease.value.read(0n, size, context.signal))
        } finally {
          await lease.release()
        }
      }
      const companion = {
        id: options.requirement.id,
        role: options.requirement.role,
        cardinality: options.requirement.cardinality,
        required: options.requirement.required,
        ...(bound.length > 0
          ? { state: 'resolved', bindingIds: bound.map(binding => binding.bindingId) }
          : { state: 'missing' }),
      }
      return {
        detection: { confidence: 0.99, kind: 'magic', note: 'synthetic W3D chunk header' },
        summary: {
          modelBytes: bytes.byteLength,
          // the companion's bytes verbatim, so the test can compare them with the fixture on disk
          // and prove the RefPack path through the container is byte-exact
          skin: skin ?? null,
          boundBindingIds: bound.map(binding => binding.bindingId),
          // the container reference the host bound, which the codec reports but never constructs
          skinSource: bound.map(binding => binding.source.uri),
        },
        metadata: [],
        companions: [companion],
        traits: [
          { id: 'model.geometry', parameters: { bytes: String(bytes.byteLength) } },
          ...(skin === undefined
            ? []
            : [{ id: 'model.textures', parameters: { bytes: String(skin.length) } }]),
        ],
      }
    },
  })
