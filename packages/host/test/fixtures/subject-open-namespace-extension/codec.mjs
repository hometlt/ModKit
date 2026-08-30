import { createInspectionCodec } from '../../../../../packages/codec-kit/src/index.js'

export const abiVersion = 1

export const createCodec = () =>
  createInspectionCodec({
    id: 'org.example/namespace-project',
    format: { id: 'namespace-project', label: 'Namespace project' },
    namespace: {
      async detect(markers) {
        const found = markers.some(
          marker => marker.path === 'project.marker' && marker.kind === 'file',
        )
        return {
          confidence: found ? 0.99 : 0,
          kind: 'structure',
          note: found ? 'project.marker exists' : 'project.marker is missing',
        }
      },
      async inspect(namespace, context) {
        const markerLease = await namespace.open('project.marker', context.signal)
        try {
          if (markerLease.value.kind !== 'bytes')
            throw new TypeError('project.marker must be a file')
          const size = Number(markerLease.value.size ?? 0n)
          const bytes = await markerLease.value.read(0n, size, context.signal)
          return {
            detection: { confidence: 0.99, kind: 'structure', note: 'project.marker exists' },
            summary: { marker: new TextDecoder().decode(bytes) },
            metadata: [],
            traits: [{ id: 'structure.hierarchy' }],
          }
        } finally {
          await markerLease.release()
        }
      },
    },
  })
