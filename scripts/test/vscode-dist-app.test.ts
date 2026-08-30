import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const app = join(root, 'apps', 'vscode')

describe('VS Code generated release artifact', () => {
  it('keeps dist-app generated while every release entry point rebuilds it', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'apps/vscode/dist-app'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    expect(tracked).toBe('')

    const ignore = readFileSync(join(root, '.gitignore'), 'utf8')
    expect(ignore.split(/\r?\n/u)).toContain('apps/vscode/dist-app/')

    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as {
      main: string
      files: string[]
      scripts: Record<string, string>
    }
    expect(manifest.main).toBe('./dist-app/extension.cjs')
    expect(manifest.files).toContain('dist-app')
    expect(manifest.scripts.prepack).toBe('pnpm ext:build')
    expect(manifest.scripts['vscode:prepublish']).toBe('pnpm ext:build')
    expect(manifest.scripts['dist-app:check']).toContain('--check')
  })
})
