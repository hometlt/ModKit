import { describe, expect, it } from 'vitest'
import { MCP_MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY } from '../src/host-port.js'

describe('MCP map preview policy', () => {
  it('budgets a complete six-root SC2 retail catalog plan', () => {
    const sixRootMinimum = 6 * 18 + 6
    expect(MCP_MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY.limits.maxRequirements).toBeGreaterThanOrEqual(
      sixRootMinimum,
    )
    expect(MCP_MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY.limits.maxRequirements).toBe(512)
  })
})
