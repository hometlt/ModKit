import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('service operation command palette wiring', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'extension.ts'), 'utf8')

  it('uses the combined command runtime and exposes catalog and invoke entries', () => {
    expect(source).toContain('createModkitCommandRuntime()')
    expect(source).toContain("picked.description === 'service.operations'")
    expect(source).toContain("picked.description === 'service.invoke'")
    expect(source).toContain('operationInput: JSON.parse(authoredInput)')
  })

  it('routes service operations across the host and worker targets with conservative effects', () => {
    // Three palette routes plus the two the image view's extension sections use (list and run).
    expect(source.match(/alternateTargets: \[host\.services\.target\]/gu)).toHaveLength(5)
    expect(source).toContain("allowedEffects: ['none']")
    expect(source).toMatch(
      /serviceOperations:\s*\{[\s\S]*catalog:[\s\S]*discoverServiceOperations\([\s\S]*invoke:[\s\S]*invokeServiceOperation\(/u,
    )
  })
})
