import { expect, it } from 'vitest'
import { contentPathIndexSemanticInputs } from '../src/language/content-path-index.js'
import { validatedLanguageWorkspaceSemanticInputs } from '../src/language/context.js'
import { DEFAULT_PROTOCOL_LIMITS, validateWireValue } from '../src/execution/protocol.js'

it('keeps a small or empty index compatible with its existing semantic input', () => {
  for (const paths of [[], ['Base.SC2Assets/Assets/Textures/marine.dds']]) {
    expect(
      contentPathIndexSemanticInputs({
        id: 'game:context',
        revision: '1',
        isComplete: true,
        paths,
      }),
    ).toEqual([
      {
        kind: 'content-path-index',
        id: 'game:context',
        revision: '1',
        payload: { schemaVersion: 1, isComplete: true, paths },
      },
    ])
  }
})

it('transports a full installation index without overflowing arrays or losing path owners', () => {
  // Past 114688, lexical chunk ids differ from their original numeric order.
  const paths = Array.from({ length: 150_005 }, (_, index) => `Assets/Textures/${index}.dds`)
  const layers = paths.map((_, index) => index % 3)
  const inputs = contentPathIndexSemanticInputs({
    id: 'game:context',
    revision: '1',
    isComplete: true,
    paths,
    layers,
  })
  expect(validateWireValue(inputs, DEFAULT_PROTOCOL_LIMITS, 'forbid').ok).toBe(true)
  const payloads = inputs.map(input => input.payload as { paths: string[]; layers: number[] })
  const capturedPaths = payloads.flatMap(payload => payload.paths)
  const capturedLayers = payloads.flatMap(payload => payload.layers)
  expect(capturedPaths).toHaveLength(paths.length)
  expect(capturedLayers).toHaveLength(layers.length)
  expect(capturedPaths.every((path, index) => path === paths[index])).toBe(true)
  expect(capturedLayers.every((layer, index) => layer === layers[index])).toBe(true)
  expect(new Set(inputs.map(input => input.id)).size).toBe(inputs.length)
  expect(inputs[0]?.id).toBe('game:context')
})

it('preserves the incomplete status in every part', () => {
  const inputs = contentPathIndexSemanticInputs({
    id: 'game:context',
    revision: '1',
    isComplete: false,
    paths: Array.from({ length: 20_000 }, (_, index) => `${index}`),
  })
  expect(inputs.length).toBeGreaterThan(1)
  expect(
    inputs.every(input => (input.payload as { isComplete: boolean }).isComplete === false),
  ).toBe(true)
})

it('refuses mismatched path owners', () => {
  expect(() =>
    contentPathIndexSemanticInputs({
      id: 'game:context',
      revision: '1',
      isComplete: true,
      paths: ['one.dds'],
      layers: [],
    }),
  ).toThrow('content path owners')
})

it('captures paths at the canonical context owner without trusting caller-owned arrays', () => {
  const paths = ['one.dds']
  const layers = [0]
  const inputs = contentPathIndexSemanticInputs({
    id: 'game:context',
    revision: '1',
    isComplete: true,
    paths,
    layers,
  })
  paths[0] = 'changed.dds'
  layers[0] = 1
  expect(inputs[0]?.payload).toEqual({
    schemaVersion: 1,
    isComplete: true,
    paths: ['one.dds'],
    layers: [0],
  })
  expect(validatedLanguageWorkspaceSemanticInputs(inputs)[0]).toBe(inputs[0])
})
