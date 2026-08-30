import { describe, expect, it } from 'vitest'
import { resolveResolvedDataWorkspace } from '@modkitx-x3/host/data'
import { createModkit, workerBackendPolicy } from '@modkitx-x3/host/node'

describe('worker-brokered resolved data provider', () => {
  it('resolves the SC2 provider without trusting its extension process', async () => {
    const extension = process.env.MODKIT_MCP_SC2_GAME_EXTENSION
    if (extension === undefined) throw new Error('MODKIT_MCP_SC2_GAME_EXTENSION is required')
    const modkit = await createModkit({
      extensions: [],
      userExtensions: [extension],
      roots: [extension],
      intent: 'inspect',
      policy: workerBackendPolicy({ defaultCallDeadlineMs: 120_000 }),
    })
    try {
      const resolved = await resolveResolvedDataWorkspace({
        services: modkit.services,
        gameId: 'org.modkitx/starcraft-2',
        grant: { id: 'mcp-worker-provider-corpus', classes: [] },
        budgets: {
          maxInputBytes: 1n,
          maxDepth: 8,
          maxNodes: 1_000,
          maxScalarBytes: 1_024,
          maxDiagnostics: 100,
        },
      })
      expect(resolved.state, JSON.stringify(resolved.diagnostics, null, 2)).toBe('resolved')
      if (resolved.state === 'resolved') await resolved.release()
    } finally {
      await modkit.close()
    }
  }, 120_000)
})
