/**
 * The shared body of the two companion fixture codecs.
 *
 * It exists to prove one thing: a codec that needs a second file declares that need and then reads
 * whatever the host handed back — `bindingsFor(requirementId)` and `openBinding(bindingId)`, and
 * nothing else. There is no directory listing here and no name construction — the codec may read
 * the identity of a binding it was handed, but cannot ask for one it was not; if the host
 * bound nothing, the codec reports the capability as unavailable rather than inventing it.
 */

import { createInspectionCodec } from '../../../../../packages/codec-kit/src/index.js'

const decoder = new TextDecoder()

/**
 * @param {{
 *   id: string
 *   magic: string
 *   requirement: import('@modkitx-x3/sdk').AssetInputRequirement
 * }} options
 */
export const companionCodec = options =>
  createInspectionCodec({
    id: options.id,
    format: { id: options.id.split('/')[1], label: 'Companion sibling fixture' },
    async detect(bytes) {
      const head = decoder.decode(bytes.slice(0, options.magic.length))
      return head === options.magic
        ? { confidence: 0.99, kind: 'magic', note: `${options.magic} header` }
        : { confidence: 0, kind: 'magic', note: 'header does not match' }
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
      let motion
      if (bound.length > 0) {
        const lease = await context.input.openBinding(bound[0].bindingId, context.signal)
        try {
          if (lease.value.kind !== 'bytes') throw new TypeError('companion must be a byte source')
          const size = Number(lease.value.size ?? 0n)
          motion = decoder.decode(await lease.value.read(0n, size, context.signal))
        } finally {
          await lease.release()
        }
      }
      const companion =
        bound.length > 0
          ? {
              id: options.requirement.id,
              role: options.requirement.role,
              cardinality: options.requirement.cardinality,
              required: options.requirement.required,
              state: 'resolved',
              bindingIds: bound.map(binding => binding.bindingId),
            }
          : {
              id: options.requirement.id,
              role: options.requirement.role,
              cardinality: options.requirement.cardinality,
              required: options.requirement.required,
              state: 'missing',
            }
      return {
        detection: { confidence: 0.99, kind: 'magic', note: `${options.magic} header` },
        summary: {
          header: decoder.decode(bytes.slice(0, options.magic.length)),
          // exactly what the host bound, verbatim — never a name the codec guessed
          motion: motion ?? null,
          boundBindingIds: bound.map(binding => binding.bindingId),
        },
        metadata: [],
        companions: [companion],
        traits: [
          {
            id: 'model.geometry',
            parameters: { header: decoder.decode(bytes.slice(0, options.magic.length)) },
          },
          ...(motion === undefined
            ? []
            : [{ id: 'model.animations', parameters: { companion: motion } }]),
        ],
      }
    },
  })
