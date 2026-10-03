import type { LanguageWorkspaceSemanticInput } from '@modkit/sdk/language'

/** Keep each path array within the execution protocol's bounds without dropping any paths. */
const PATHS_PER_INPUT = 16_384

export function contentPathIndexSemanticInputs(index: {
  readonly id: string
  readonly revision: string
  readonly isComplete: boolean
  readonly paths: readonly string[]
  readonly layers?: readonly number[]
}): readonly LanguageWorkspaceSemanticInput[] {
  if (index.layers !== undefined && index.layers.length !== index.paths.length)
    throw new TypeError('content path owners must match the indexed paths')
  const inputs: LanguageWorkspaceSemanticInput[] = []
  for (let start = 0; start < Math.max(1, index.paths.length); start += PATHS_PER_INPUT) {
    inputs.push(
      Object.freeze({
        kind: 'content-path-index',
        id: start === 0 ? index.id : `${index.id}/paths/${start}`,
        revision: index.revision,
        payload: Object.freeze({
          schemaVersion: 1,
          isComplete: index.isComplete,
          paths: Object.freeze(index.paths.slice(start, start + PATHS_PER_INPUT)),
          ...(index.layers === undefined
            ? {}
            : {
                layers: Object.freeze(index.layers.slice(start, start + PATHS_PER_INPUT)),
              }),
        }),
      }),
    )
  }
  return Object.freeze(inputs)
}
