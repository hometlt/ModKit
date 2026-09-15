import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseServiceOperationArguments,
  runServiceOperationCommand,
} from '../src/service-operations.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixtureExtension(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modkit-cli-service-operation-'))
  temporary.push(root)
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@fixture/cli-service',
      version: '1.0.0',
      license: 'MIT',
      type: 'module',
      modkit: {
        schemaVersion: 1,
        publisher: 'fixture',
        id: 'cli-service',
        contributionManifests: ['./provider.contribution.json'],
      },
    }),
  )
  await writeFile(
    join(root, 'provider.contribution.json'),
    JSON.stringify({
      schemaVersion: 1,
      contract: { id: 'modkit/service-provider-contribution', major: 1 },
      id: 'fixture/cli-service',
      displayName: 'CLI fixture operation',
      runtimeVariants: [
        {
          variantId: 'trusted-node',
          entrypoint: './provider.js',
          target: { environments: ['node'] },
          executionProfile: 'trusted-in-process',
          requestedPermissionClasses: [],
        },
      ],
      spec: {
        provides: [
          {
            offerId: 'echo-v1',
            contract: 'common.runtime/operation-provider',
            major: 1,
            version: '1.0.0',
            facet: { operationIds: ['fixture.cli.echo'] },
          },
        ],
        lifecycleScope: 'operation',
      },
    }),
  )
  await writeFile(
    join(root, 'provider.js'),
    `export const abiVersion = 1
export const provides = Object.freeze(['common.runtime/operation-provider'])
export function createProvider() {
  return {
    value: {
      contract: 'common.runtime/operation-provider',
      providerId: 'fixture/cli-service',
      operations: [{
        schemaVersion: 1,
        id: 'fixture.cli.echo',
        title: 'Echo',
        summary: 'Return inert input.',
        requiredPermissions: [],
        effects: 'none',
        inputSchema: { type: 'object' },
        resultSchema: { type: 'object' },
        budget: { maxInputBytes: 1024, maxOutputBytes: 1024, maxWallTimeMs: 1000 }
      }],
      async invoke(request) {
        return { state: 'completed', operationId: request.operationId, value: request.input, diagnostics: [] }
      }
    },
    async release() {}
  }
}
`,
  )
  return root
}

describe('generic service-operation CLI', () => {
  it('parses bounded catalog and explicitly authorized invocation arguments', () => {
    expect(
      parseServiceOperationArguments('catalog', undefined, [
        '--ext',
        'fixture',
        '--permission',
        'network',
        '--limit',
        '25',
      ]),
    ).toMatchObject({ mode: 'catalog', roots: ['fixture'], permissions: ['network'], limit: 25 })
    expect(
      parseServiceOperationArguments('invoke', 'fixture.cli.echo', [
        '--ext',
        'fixture',
        '--input',
        'input.json',
        '--allow-effectful',
      ]),
    ).toMatchObject({ mode: 'invoke', operationId: 'fixture.cli.echo', allowEffectful: true })
    expect(
      parseServiceOperationArguments('catalog', undefined, ['--ext', 'fixture', '--limit', '101']),
    ).toBeUndefined()
  })

  it('loads a directory extension and uses one CommandRuntime route for catalog and invoke', async () => {
    const root = await fixtureExtension()
    const input = join(root, 'input.json')
    await writeFile(input, JSON.stringify({ message: 'hello' }))
    const output: string[] = []
    const errors: string[] = []
    const catalog = parseServiceOperationArguments('catalog', undefined, [
      '--ext',
      root,
      '--trust',
      '--format',
      'json',
    ])!
    await expect(
      runServiceOperationCommand(catalog, {
        writeStdout: text => output.push(text),
        writeStderr: text => errors.push(text),
      }),
    ).resolves.toBe(0)
    const catalogResult = JSON.parse(output.pop()!)
    if (catalogResult.data.entries[0]?.state !== 'activatable') {
      throw new Error(JSON.stringify(catalogResult))
    }
    expect(catalogResult).toMatchObject({
      state: 'ok',
      command: 'service.operations',
      data: { entries: [{ operationId: 'fixture.cli.echo', state: 'activatable' }] },
    })
    const invoke = parseServiceOperationArguments('invoke', 'fixture.cli.echo', [
      '--ext',
      root,
      '--input',
      input,
      '--trust',
      '--format',
      'json',
    ])!
    await expect(
      runServiceOperationCommand(invoke, {
        writeStdout: text => output.push(text),
        writeStderr: text => errors.push(text),
      }),
    ).resolves.toBe(0)
    expect(JSON.parse(output.pop()!)).toMatchObject({
      state: 'ok',
      command: 'service.invoke',
      data: { result: { state: 'completed', value: { message: 'hello' } } },
    })
    expect(errors).toEqual([])
  })
})
