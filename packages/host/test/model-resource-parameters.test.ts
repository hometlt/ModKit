import { expect, it } from 'vitest'
import type { ArtifactByteSource, ResourceSessionPort } from '@modkit/sdk'
import type { OpenSubjectResult } from '../src/subject-open.js'
import { createSubjectModelResources } from '../src/model-resources.js'
import { resourceIdParameters } from '../src/resource-id.js'

const budget = {
  maxInputBytes: 100000n,
  maxScalarBytes: 100000,
  maxDepth: 16,
  maxNodes: 1000,
  maxDiagnostics: 30,
}

/** A sprite file whose codec exports the frame its parameters name as a one-byte "model". */
function sprites() {
  const resolved: string[] = []
  const inputs: unknown[] = []
  const source = {
    kind: 'bytes',
    ref: { id: 'sprites', uri: 'memory://sprites' },
    revision: 'sprites-revision',
    size: 20n,
  } as unknown as ArtifactByteSource
  const resources = {
    async resolve(requirement: { logicalId: string }) {
      resolved.push(requirement.logicalId)
      return {
        state: 'resolved',
        lease: { value: source, async release() {} },
        revision: source.revision,
        provenance: {
          logicalId: requirement.logicalId,
          requirementId: 'sprite',
          role: 'sidecar',
          state: 'resolved',
          cached: false,
          scopes: ['current-mount'],
        },
      }
    },
  } as unknown as ResourceSessionPort
  const state = { live: true, reservedBytes: 0, resources }
  const port = createSubjectModelResources({
    state,
    budget,
    isAuthorized: () => state.live,
    own: () => undefined,
    ancestors: ['map@revision'],
    async open(_source, path) {
      if (path.endsWith('.uvm'))
        return {
          state: 'opened',
          diagnostics: [],
          resources,
          descriptor: { operations: [] },
          session: {
            async dispose() {},
            async dataSource() {
              throw new Error('no scene in this fixture')
            },
          },
        } as unknown as OpenSubjectResult
      return {
        state: 'opened',
        diagnostics: [],
        resources,
        descriptor: {
          revision: 'provider-token:sprites',
          operations: [
            {
              id: 'model.export-uvm',
              handlerId: 'convert',
              state: 'available',
              mutatesSource: false,
            },
          ],
        },
        session: {
          async dispose() {},
          operations() {
            return {
              async invoke(_handler: string, input: { parameters?: { frame?: string } }) {
                inputs.push(input)
                return {
                  state: 'ok',
                  output: {
                    kind: 'bytes',
                    value: Uint8Array.of(Number(input.parameters?.frame ?? 0)),
                  },
                  diagnostics: [],
                }
              },
            }
          },
        },
      } as unknown as OpenSubjectResult
    },
  })
  return { port, resolved, inputs }
}

const asked = (logicalId: string) => ({
  requirement: {
    id: 'sprite',
    logicalId,
    role: 'sidecar' as const,
    scopes: ['current-mount'] as const,
  },
  maxBytes: 4096,
})

it('exports the model a parameterised logical id names, from the file before `#` (C2, DM2)', async () => {
  const { port, resolved, inputs } = sprites()
  const three = await port.acquire(asked('data/DATA.R16#frame=3'))
  const five = await port.acquire(asked('data/DATA.R16#frame=5'))
  try {
    expect(resolved).toEqual(['data/DATA.R16', 'data/DATA.R16'])
    expect(inputs).toEqual([
      { schemaVersion: 1, parameters: { frame: '3' } },
      { schemaVersion: 1, parameters: { frame: '5' } },
    ])
    // each parameter set is a model of its own
    if (three.value.result.state !== 'converted' || five.value.result.state !== 'converted')
      throw new Error('not converted')
    expect([...three.value.result.bytes]).toEqual([3])
    expect([...five.value.result.bytes]).toEqual([5])
    expect(three.value.result.sourceKey).not.toBe(five.value.result.sourceKey)
  } finally {
    await three.release()
    await five.release()
  }
})

it('reads a parameter list only where the fragment is one', () => {
  expect(resourceIdParameters('unit/htnk.vxl#palette=unit%20tem.pal&turretOffset=0')).toEqual({
    name: 'unit/htnk.vxl',
    parameters: { palette: 'unit tem.pal', turretOffset: '0' },
  })
  for (const name of ['Textures/#odd.dds', 'a.r16#frame', 'a.r16#frame=1&frame=2', 'a#=1'])
    expect(resourceIdParameters(name)).toEqual({ name, parameters: {} })
})
