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
  it('emits the manifest and contributions together without changing package identity', () => {
    const output = tempPath('contributes.json')
    const target = tempPath('package.json')
    writeFileSync(
      target,
      JSON.stringify({ name: 'fixture', version: '2.0.0', scripts: { test: 'keep' } }),
    )
    const result = spawnSync(
      process.execPath,
      [generator, '--output', output, '--manifest', target],
      { encoding: 'utf8' },
    )
    expect(result.status, result.stderr).toBe(0)
    const manifestDocument = JSON.parse(readFileSync(target, 'utf8'))
    expect(manifestDocument).toMatchObject({
      name: 'fixture',
      version: '2.0.0',
      scripts: { test: 'keep' },
    })
    expect(manifestDocument.contributes).toEqual(JSON.parse(readFileSync(output, 'utf8')))
    expect(run(output, target).status).toBe(0)
  })

  it('shows Verify only when the active document has a provider', () => {
    const contributions = JSON.parse(readFileSync(generated, 'utf8'))
    expect(contributions.commands).toContainEqual({
      command: 'modkit.verifyDocument',
      title: '%command.verifyDocument%',
      icon: '$(check)',
      enablement: 'modkit.canVerifyDocument',
    })
    expect(contributions.menus['editor/title']).toContainEqual({
      command: 'modkit.verifyDocument',
      when: 'modkit.canVerifyDocument',
      group: 'navigation@4',
    })
  })

  it('pins generated contributions and their ordered activation events to package.json', () => {
    const authorityDocument = JSON.parse(readFileSync(authority, 'utf8'))
    // One event per command, custom editor, view, file system scheme and debugger; the rest are the
    // extensions' workspace markers (workspaceContains), collected when the manifest is generated.
    const activationEvents = (
      JSON.parse(readFileSync(manifest, 'utf8')) as { activationEvents: readonly string[] }
    ).activationEvents
    expect(activationEvents.filter(event => !event.startsWith('workspaceContains:'))).toHaveLength(
      authorityDocument.commands.length +
        authorityDocument.customEditors.length +
        Object.values(authorityDocument.views as Record<string, unknown[]>).flat().length +
        authorityDocument.fileSystemSchemes.length +
        authorityDocument.debuggers.length,
    )
    const expectedActivationEventCount = activationEvents.length
    const result = run()

    expect(
      authorityDocument.commands.some(
        (row: { command: string }) => row.command === 'modkit.verifyDocument',
      ),
    ).toBe(true)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(`${expectedActivationEventCount} activation events`)
  })

  it('publishes the persistent Sources view with shared source commands', () => {
    const contributions = JSON.parse(readFileSync(generated, 'utf8')) as {
      commands: readonly { command: string; icon?: string }[]
      views: Readonly<Record<string, readonly { id: string; name: string }[]>>
      menus: Readonly<Record<string, readonly { command: string; when: string; group: string }[]>>
    }
    const commands = new Map(contributions.commands.map(command => [command.command, command]))

    expect(contributions.views.modkit).toContainEqual({
      id: 'modkit.sources',
      name: '%view.sources%',
    })
    expect(contributions.views.modkit).not.toContainEqual(
      expect.objectContaining({ id: 'modkit.host' }),
    )
    expect(commands.get('modkit.sources.refresh')?.icon).toBe('$(refresh)')
    expect(commands.get('modkit.sources.open')?.icon).toBe('$(plug)')
    expect(commands.get('modkit.sources.openInstallation')?.icon).toBe('$(plug)')
    expect(commands.get('modkit.sources.revealLocal')?.icon).toBe('$(folder)')
    expect(contributions.menus['view/title']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'modkit.contentSources',
          when: 'view == modkit.sources',
        }),
        expect.objectContaining({
          command: 'modkit.selectGameInstallation',
          when: 'view == modkit.sources',
        }),
        expect.objectContaining({
          command: 'modkit.sources.refresh',
          when: 'view == modkit.sources',
        }),
      ]),
    )
    expect(contributions.menus['view/item/context']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'modkit.sources.open',
          when: 'view == modkit.sources && viewItem =~ /^modkitSource\\.(?:providerRoot|publicRoot|localRoot)$/',
        }),
        expect.objectContaining({
          command: 'modkit.sources.openInstallation',
          when: 'view == modkit.sources && viewItem == modkitSource.installation',
        }),
        expect.objectContaining({
          command: 'modkit.unloadSource',
          when: 'view == modkit.sources && viewItem =~ /^modkitSource\\.installation(?:\\.(?:mounted|mounting))?$/',
        }),
        expect.objectContaining({
          command: 'modkit.sources.revealLocal',
          when: 'view == modkit.sources && viewItem =~ /^modkitSource\\.localRoot(?:\\.(?:mounted|mounting))?$/',
        }),
      ]),
    )
    expect(contributions.menus['explorer/context']).toContainEqual(
      expect.objectContaining({
        command: 'modkit.sources.revealLocal',
        when: 'resourceScheme == modkit-source || resourceScheme == modkit-container',
      }),
    )
  })

  it('publishes the generic active-subject Resources view', () => {
    const contributions = JSON.parse(readFileSync(generated, 'utf8')) as {
      commands: readonly { command: string; icon?: string }[]
      views: Readonly<Record<string, readonly { id: string; name: string }[]>>
      menus: Readonly<Record<string, readonly { command: string; when: string; group: string }[]>>
    }
    const commands = new Map(contributions.commands.map(command => [command.command, command]))
    expect(contributions.views.modkit).toContainEqual({
      id: 'modkit.resources',
      name: '%view.resources%',
    })
    expect(commands.get('modkit.resources.search')?.icon).toBe('$(search)')
    expect(commands.get('modkit.resources.refresh')?.icon).toBe('$(refresh)')
    expect(contributions.menus['view/title']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'modkit.resources.search',
          when: 'view == modkit.resources',
        }),
        expect.objectContaining({
          command: 'modkit.resources.refresh',
          when: 'view == modkit.resources',
        }),
      ]),
    )
    expect(contributions.menus['view/item/context']).toContainEqual(
      expect.objectContaining({
        command: 'modkit.resources.open',
        when: 'view == modkit.resources && viewItem =~ /^modkitResource\\.openable/',
      }),
    )
  })

  it('pins codec toggles and mutable extension actions to inline tree menus', () => {
    const contributions = JSON.parse(readFileSync(generated, 'utf8')) as {
      commands: readonly { command: string; icon?: string }[]
      menus: Readonly<Record<string, readonly { command: string; when: string; group: string }[]>>
    }
    const commands = new Map(contributions.commands.map(command => [command.command, command]))
    const inline = (contributions.menus['view/item/context'] ?? []).filter(item =>
      item.when.includes('view == modkit.extensions'),
    )

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
