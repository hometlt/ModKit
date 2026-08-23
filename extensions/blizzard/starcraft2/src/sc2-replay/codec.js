// Hand-ported SC2Replay container inspection. Protocol/event decoding is build-specific and stays
// outside this portable codec until an X3 decoder/runtime service contract exists.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { createTableDataSource } from '../galaxy/codec.js'
import { findReplaySignature, mpqMagic, parseSc2Mpq, sc2ArchiveEntryNames } from '../sc2-map/mpq.js'

const ID = 'org.modkitx/sc2-replay'
const KNOWN_STREAMS = new Map([
  ['replay.details', 'details'],
  ['replay.initdata', 'initialization'],
  ['replay.attributes.events', 'attributes'],
  ['replay.game.events', 'game-events'],
  ['replay.message.events', 'message-events'],
  ['replay.tracker.events', 'tracker-events'],
])

function streamRole(path) {
  return KNOWN_STREAMS.get(path.toLocaleLowerCase()) ?? ''
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'sc2-replay', label: 'StarCraft II replay' }),
  async detect(prefix) {
    if (mpqMagic(prefix) !== 'MPQ\u001b') {
      return { confidence: 0, kind: 'magic', note: 'mpq-user-data-missing' }
    }
    const offset = findReplaySignature(prefix)
    return offset < 0
      ? { confidence: 0, kind: 'structure', note: 'sc2-replay-signature-missing' }
      : { confidence: 0.999, kind: 'structure', note: `sc2-replay-signature@${offset}` }
  },
  async inspect(bytes, context) {
    const signatureOffset = findReplaySignature(bytes)
    if (signatureOffset < 0) throw new TypeError('SC2Replay user data has no replay signature')
    const archive = parseSc2Mpq(bytes, context.budget.maxNodes)
    const paths = sc2ArchiveEntryNames(archive)
    const known = paths.filter(path => streamRole(path) !== '')
    return {
      summary: {
        format: 'sc2-replay',
        signature: 'StarCraft II replay',
        signatureOffset,
        userDataBytes: archive.header.userDataBytes,
        mpqVersion: archive.header.version,
        entries: archive.entries.length,
        knownStreams: known.length,
        streamNames: known,
      },
      metadata: [
        {
          id: 'sc2-replay',
          label: 'SC2Replay container',
          entries: [
            { key: 'signatureOffset', value: signatureOffset },
            { key: 'userDataBytes', value: archive.header.userDataBytes },
            { key: 'mpqVersion', value: archive.header.version },
            { key: 'entries', value: archive.entries.length },
            { key: 'knownStreams', value: known },
          ],
        },
      ],
      traits: [
        { id: 'game.replay', parameters: { streams: known.length, decoded: false } },
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        { id: 'structure.hierarchy', parameters: { entries: archive.entries.length } },
      ],
      dataSources: {
        'common.view/table-data-source': createTableDataSource(
          ['Path', 'Bytes', 'Replay role'],
          archive.entries.map(entry => [entry.path, entry.size, streamRole(entry.path)]),
        ),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'replay',
          label: 'StarCraft II replay',
          preview: `${known.length} known stream(s), ${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: streamRole(entry.path) === '' ? 'file' : 'replay-stream',
            label: entry.path,
            preview: streamRole(entry.path) || `${entry.size} bytes`,
          })),
        }),
      },
      unsupportedFeatures: [
        'build-specific-protocol-decoding',
        'replay-header-and-details-decoding',
        'tracker-and-game-event-analysis',
        'timeline-rendering',
        'playback-and-seeking',
        'runtime-divergence-correction',
        'compressed-or-encrypted-listfiles',
        'high-offset-mpq-tables',
        'replay-editing-and-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
