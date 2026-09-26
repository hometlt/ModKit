import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createHostMcpPort, type ModkitMcpHostPort } from '../src/index.js'

// A6: the MCP host never prompts; a declared key comes from the variable its declaration names,
// and only its status leaves the broker.
const SECRET = 'SECRET-MARKER-mcp-8d20'
const VARIABLE = 'MODKIT_TEST_EXAMPLE_CLOUD_KEY'
let host: ModkitMcpHostPort | undefined
afterAll(async () => {
  delete process.env[VARIABLE]
  await host?.close()
})

describe('MCP credentials', () => {
  it('reads a declared key from the environment and reports its status only', async () => {
    process.env[VARIABLE] = SECRET
    const extension = resolve(import.meta.dirname, 'fixtures/credentials-extension')
    host = await createHostMcpPort({ roots: [extension], extensions: [extension] })
    const statuses = await host.credentialStatus!()
    expect(statuses).toEqual([
      {
        id: 'org.example/cloud',
        extension: 'org.example/credentials-extension',
        kind: 'api-key',
        label: 'Example cloud key',
        status: 'available',
        scoped: false,
        environment: VARIABLE,
      },
    ])
    expect(JSON.stringify(statuses)).not.toContain(SECRET)
  }, 30_000)
})
