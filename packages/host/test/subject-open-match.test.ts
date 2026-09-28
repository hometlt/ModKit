import { describe, expect, it } from 'vitest'
import { matchesSpec } from '../src/subject-open.js'

const spec = { match: { extensions: ['cpf'] } } as never

describe('codec match by name', () => {
  it('keeps # and ? in a plain path and ends a URI path at its query or fragment', () => {
    expect(matchesSpec(spec, '#M61 Isles of Caladan/test.CPF')).toBe(true)
    expect(matchesSpec(spec, 'C:\Maps\#M61 Isles\test.cpf')).toBe(true)
    expect(matchesSpec(spec, 'file:///maps/test.cpf#frag')).toBe(true)
    expect(matchesSpec(spec, 'file:///maps/test.cpf?vfs-path=a.xbf')).toBe(true)
    expect(matchesSpec(spec, 'file:///maps/test.xbf')).toBe(false)
  })
})
