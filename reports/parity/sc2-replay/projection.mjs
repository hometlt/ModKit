// Declared SC2 replay comparison projection, applied to both arms.
export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  typeof item === 'bigint' ? String(item) : ArrayBuffer.isView(item) ? Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString('hex') : item)))

export function project(probe, { legacy, native, value }) {
  switch (probe) {
    case 'detect':
    case 'export.raw':
      return plain(value)
    case 'view.inspect':
      // Shared replay identity; MK3 adds container and stream statistics.
      return legacy !== undefined
        ? {
            title: legacy.details.title, players: legacy.details.players.length,
            build: legacy.header.version.build, baseBuild: legacy.header.version.baseBuild,
            elapsedGameLoops: legacy.header.elapsedGameLoops, trackerEvents: legacy.tracker.eventCount,
          }
        : {
            title: native.title, players: native.players, build: native.build, baseBuild: native.baseBuild,
            elapsedGameLoops: native.elapsedGameLoops, trackerEvents: native.trackerEvents,
          }
    case 'asset.validate':
      return (legacy ?? native ?? []).map(item => ({ code: item.code, severity: item.severity }))
    case 'media.seek':
      // MK2 clock (loops, seconds) and MK3 media transport (milliseconds) state the same position.
      // Duration is not compared: MK2 uses max(header loops, timeline), MK3 the timeline (one loop less).
      return legacy !== undefined
        ? { playing: legacy.playing, positionMs: Math.round(legacy.seconds * 1000) }
        : { playing: native.state === 'playing', positionMs: Math.round(Number(native.positionMs)) }
    case 'media.play':
      // After a toggle the wall clock moves the position; only the transport state is compared.
      return { playing: legacy !== undefined ? legacy.playing : native.state === 'playing' }
    case 'view.render': {
      const source = legacy ?? native
      const { trackIndices: _indices, ...scene } = source.scene
      return plain({ scene, timeline: source.timeline })
    }
    case 'export.convert':
      return legacy !== undefined
        ? plain({
            title: legacy.details.title, build: legacy.header.version.build, elapsedGameLoops: legacy.header.elapsedGameLoops,
            trackerEvents: legacy.tracker.eventCount, gameEvents: legacy.optionalStreams.gameEvents,
            messageEvents: legacy.optionalStreams.messageEvents, timeline: legacy.timeline,
          })
        : plain({
            title: native.inspect.title, build: native.inspect.build, elapsedGameLoops: native.inspect.elapsedGameLoops,
            trackerEvents: native.inspect.trackerEvents, gameEvents: native.inspect.gameEvents,
            messageEvents: native.inspect.messageEvents, timeline: native.timeline,
          })
    default:
      return plain(legacy ?? native)
  }
}
