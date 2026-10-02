import { verifyScenarioComposition } from './uv-contract-verifier.ts'

self.onmessage = event => {
  try {
    const { registry, inputs }: { registry: unknown; inputs: readonly {
      document: unknown; required: readonly string[]; granted: readonly string[]
    }[] } = event.data
    const result = inputs.map(input => verifyScenarioComposition([
      { packageId: 'example/scenario', path: 'scenario.uvs.json', document: input.document },
    ], [], registry, [{ id: 'example/scenario', requires: { intrinsics: input.required } }], input.granted))
    self.postMessage({ result })
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
