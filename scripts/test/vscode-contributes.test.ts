import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const appRoot = join(repoRoot, 'apps', 'vscode')
const generator = join(appRoot, 'scripts', 'generate-contributes.mjs')
const authority = join(appRoot, 'bundled-contributes.v1.json')
const generated = join(appRoot, 'contributes.generated.json')
const manifest = join(appRoot, 'package.json')

function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'modkitx-vscode-contributes-')), name)
}

function run(output = generated, packageManifest = manifest) {
  return spawnSync(
    process.execPath,
    [
      generator,
      '--check',
      '--authority',
      authority,
      '--output',
      output,
      '--manifest',
      packageManifest,
    ],
    { encoding: 'utf8' },
  )
}

describe('generated VS Code contributions', () => {
  it('pins generated contributions and their ordered activation events to package.json', () => {
    const authorityDocument = JSON.parse(readFileSync(authority, 'utf8'))
    const expectedActivationEventCount =
      authorityDocument.commands.length +
      authorityDocument.customEditors.length +
      Object.values(authorityDocument.views as Record<string, unknown[]>).flat().length +
      authorityDocument.fileSystemSchemes.length
    const result = run()

    expect(expectedActivationEventCount).toBe(30)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(`${expectedActivationEventCount} activation events`)
  })

  it('rejects a package contribution that is absent from the generated authority', () => {
    const brokenManifest = JSON.parse(readFileSync(manifest, 'utf8'))
    brokenManifest.contributes.commands[0].title = 'Drifted title'
    const manifestPath = tempPath('package.json')
    writeFileSync(manifestPath, JSON.stringify(brokenManifest))

    const result = run(generated, manifestPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'package.json.contributes must exactly equal contributes.generated.json',
    )
  })

  it.each(['missing', 'extra', 'reordered'] as const)('rejects %s activation events', mutation => {
    const brokenManifest = JSON.parse(readFileSync(manifest, 'utf8'))
    if (mutation === 'missing') brokenManifest.activationEvents.pop()
    if (mutation === 'extra') brokenManifest.activationEvents.push('onCommand:modkit.unallocated')
    if (mutation === 'reordered') brokenManifest.activationEvents.reverse()
    const manifestPath = tempPath('package.json')
    writeFileSync(manifestPath, JSON.stringify(brokenManifest))

    const result = run(generated, manifestPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'package.json.activationEvents must exactly match the derived ordered activation events',
    )
  })
})
