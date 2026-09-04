import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = join(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  readonly name?: string
  readonly exports?: Readonly<Record<string, string>>
  readonly modkit?: unknown
}
const contribution = JSON.parse(
  readFileSync(join(packageRoot, 'contributions', 'editor-monaco-code.json'), 'utf8'),
) as {
  readonly id?: string
  readonly runtimeVariants?: readonly { readonly entrypoint?: string }[]
}

describe('@modkit/code package boundary', () => {
  it('is a built-in package rather than an installable extension artifact', () => {
    expect(packageJson.name).toBe('@modkit/code')
    expect(packageJson.modkit).toBeUndefined()
    expect(packageJson.exports?.['./module']).toMatchObject({
      types: './dist/module.d.ts',
      default: './dist/module.js',
    })
  })

  it('preserves the published code-stage contribution identity and entrypoint', () => {
    expect(contribution.id).toBe('modkit.ui-monaco/code-stage')
    expect(contribution.runtimeVariants?.[0]?.entrypoint).toBe('./dist/index.js')
  })
})
