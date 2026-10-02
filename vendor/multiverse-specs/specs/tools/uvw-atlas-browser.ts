import { assertTerrainAtlas, assertDerivedCliffObject } from './uvw-terrain-atlas.ts'

self.onmessage = event => {
  const inputs = event.data as readonly { layer: unknown; document?: unknown; object?: unknown }[]
  const result = inputs.map(input => {
    try {
      assertTerrainAtlas(input.layer, input.document)
      if (input.object !== undefined) assertDerivedCliffObject(input.object)
      return { accepted: true }
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error),
        rule: error instanceof Error && 'rule' in error ? error.rule : undefined }
    }
  })
  self.postMessage({ result })
}
