import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * Commands that act on one tree row or card and return without it are hidden from the palette
 * (plan 8.1): from there they could only do nothing. A command with its own fallback — a picker,
 * the active tab's container — stays.
 */
const ROW_ONLY = [
  'modkit.navigateResource',
  'modkit.resources.open',
  'modkit.sources.open',
  'modkit.sources.openInstallation',
  'modkit.sources.revealLocal',
  'modkit.sources.editCopy',
  'modkit.sources.unmount',
  'modkit.sources.download',
  'modkit.sources.clearCache',
  'modkit.sources.detach',
  'modkit.sources.disconnect',
  'modkit.sources.publish',
  'modkit.sources.deletePublication',
  'modkit.extensions.openExtension',
  'modkit.extensions.openContribution',
  'modkit.extensions.enableAllCodecs',
  'modkit.extensions.disableAllCodecs',
  'modkit.extensions.installGameSupport',
  'modkit.extensions.completeGameSupport',
  'modkit.extensions.removeGameSupport',
  'modkit.extensions.removeVendorSupport',
]

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  contributes: {
    commands: { command: string }[]
    menus: { commandPalette?: { command: string; when?: string }[] }
  }
}

describe('the command palette', () => {
  const palette = manifest.contributes.menus.commandPalette ?? []

  it('hides every command that only acts on a row or card', () => {
    const hidden = palette.filter(item => item.when === 'false').map(item => item.command)
    expect(ROW_ONLY.filter(command => !hidden.includes(command))).toEqual([])
  })

  it('names only contributed commands, and hides only the row-only ones', () => {
    const contributed = new Set(manifest.contributes.commands.map(item => item.command))
    expect(palette.filter(item => !contributed.has(item.command))).toEqual([])
    // a command with a picker or an active-tab fallback belongs in the palette
    expect(
      palette.map(item => item.command).filter(command => !ROW_ONLY.includes(command)),
    ).toEqual([])
  })
})
