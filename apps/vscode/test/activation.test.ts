import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  readonly activationEvents: readonly string[]
  readonly contributes: {
    readonly languages: readonly { readonly extensions?: readonly string[] }[]
  }
}

describe('activation (plan 8.6)', () => {
  it('waits for something of Modkit in the window instead of every startup', () => {
    expect(manifest.activationEvents).not.toContain('onStartupFinished')
    expect(manifest.activationEvents).toContain('workspaceContains:**/*.SC2Map')
    expect(manifest.activationEvents).toContain('workspaceContains:**/modkit.workspace.json')
    // every extension a contributed language names marks a workspace too
    for (const extension of manifest.contributes.languages.flatMap(item => item.extensions ?? []))
      expect(manifest.activationEvents).toContain(`workspaceContains:**/*${extension}`)
  })
})
