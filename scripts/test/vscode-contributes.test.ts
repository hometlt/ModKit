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
  return join(mkdtempSync(join(tmpdir(), 'modkit-vscode-contributes-')), name)
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

    expect(expectedActivationEventCount).toBe(39)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(`${expectedActivationEventCount} activation events`)
  })

  it('pins codec toggles and mutable extension actions to inline tree menus', () => {
    const contributions = JSON.parse(readFileSync(generated, 'utf8')) as {
      commands: readonly { command: string; icon?: string }[]
      menus: Readonly<Record<string, readonly { command: string; when: string; group: string }[]>>
    }
    const commands = new Map(contributions.commands.map(command => [command.command, command]))
    const inline = contributions.menus['view/item/context'] ?? []

    expect(commands.get('modkit.extensions.enableContribution')?.icon).toBe('$(check)')
    expect(commands.get('modkit.extensions.disableContribution')?.icon).toBe('$(circle-slash)')
    expect(commands.get('modkit.extensions.update')?.icon).toBe('$(sync)')
    expect(commands.get('modkit.extensions.remove')?.icon).toBe('$(trash)')
    expect(commands.get('modkit.extensions.installAll')?.icon).toBe('$(cloud-download)')
    expect(inline.map(item => item.command)).toEqual([
      'modkit.extensions.completeGameSupport',
      'modkit.extensions.disableAllCodecs',
      'modkit.extensions.disableContribution',
      'modkit.extensions.enableAllCodecs',
      'modkit.extensions.enableContribution',
      'modkit.extensions.install',
      'modkit.extensions.installAll',
      'modkit.extensions.installGameSupport',
      'modkit.extensions.remove',
      'modkit.extensions.removeGameSupport',
      'modkit.extensions.removeVendorSupport',
      'modkit.extensions.update',
    ])
    expect(inline).toContainEqual({
      command: 'modkit.extensions.disableContribution',
      when: 'view == modkit.extensions && viewItem == modkitContribution.codec.enabled',
      group: 'inline@1',
    })
    expect(inline).toContainEqual({
      command: 'modkit.extensions.enableContribution',
      when: 'view == modkit.extensions && viewItem == modkitContribution.codec.disabled',
      group: 'inline@1',
    })
    expect(inline).toContainEqual({
      command: 'modkit.extensions.disableAllCodecs',
      when: 'view == modkit.extensions && viewItem =~ /^modkitExtension\\.installed\\..*\\.codecs\\.enabled$/',
      group: 'inline@1',
    })
    expect(inline).toContainEqual({
      command: 'modkit.extensions.enableAllCodecs',
      when: 'view == modkit.extensions && viewItem =~ /^modkitExtension\\.installed\\..*\\.codecs\\.disabled$/',
      group: 'inline@1',
    })
    expect(inline).toContainEqual({
      command: 'modkit.extensions.installAll',
      when: 'view == modkit.extensions && viewItem == modkitExtensionGroup.available',
      group: 'inline@1',
    })
    expect(inline).toContainEqual({
      command: 'modkit.extensions.update',
      when: 'view == modkit.extensions && viewItem =~ /^modkitExtension\\.installed\\.mutable\\.update(?:\\.|$)/',
      group: 'inline@1',
    })
    expect(inline).toContainEqual({
      command: 'modkit.extensions.remove',
      when: 'view == modkit.extensions && viewItem =~ /^modkitExtension\\.installed\\.mutable(?:\\.update)?(?:\\.codecs\\.(?:enabled|disabled))?$/',
      group: 'inline@2',
    })
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
