import { describe, expect, it } from 'vitest'
import { isModkitError, ModkitError } from '../src/errors.js'

describe('a ModkitError from another copy of @modkit/core', () => {
  it('is recognised by its realm-wide brand, keeping its code', async () => {
    // A second module instance, as an extension's vendored copy of the package would be.
    const modulePath = '../src/errors.js?another-copy'
    const copy = (await import(modulePath)) as typeof import('../src/errors.js')
    expect(copy.ModkitError).not.toBe(ModkitError)
    const refused = new copy.ModkitError({ code: 'example.game/pak-encrypted', message: 'needs a key' })
    expect(refused instanceof ModkitError).toBe(false)
    expect(isModkitError(refused)).toBe(true)
    expect(isModkitError(new ModkitError({ code: 'example.game/own', message: 'own copy' }))).toBe(true)
  })

  it('does not take a plain Error with a code for a typed one', () => {
    const foreign = Object.assign(new Error('looks typed'), { code: 'example.game/fake', retryability: 'never' })
    expect(isModkitError(foreign)).toBe(false)
    expect(isModkitError({ code: 'example.game/object', message: 'not an error' })).toBe(false)
  })
})
