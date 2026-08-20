/**
 * The seams the Extensions & Codecs page is built on.
 *
 * Everything here is about what the *host* answers, because that is all the page ever shows: which
 * coordinate a directory declares, why one is refused, which contributions the inventory holds and
 * which of them the user switched off. The page's own DOM is exercised in the Electron self-test,
 * where there is a real main process to recompose; what a unit test can own is the pure half.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { normalizeSettings, serializeSettings } from '@modkitx-x3/ui/settings'

import {
  createElectronSubjectServices,
  describeInventoryContributions,
  disabledContributionNotices,
  probeElectronExtensionRoot,
  CONTRIBUTION_DISABLED_CODE,
} from '../src/index.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const imagesExtension = join(repositoryRoot, 'extensions', 'common', 'images')
const PNG_CODEC = 'org.modkitx/image-png'

/** The two directories the "connect a folder" flow is verified against, built by the fixture script. */
const extensionFolders = ((): { readonly ok: string; readonly junk: string } => {
  const target = join(mkdtempSync(join(tmpdir(), 'modkit-extfix-')), 'folders')
  execFileSync(
    process.execPath,
    [join(import.meta.dirname, 'fixtures', 'build-extension-folders.mjs'), target],
    { stdio: 'pipe' },
  )
  return { ok: join(target, 'ok'), junk: join(target, 'junk') }
})()

describe('probing a folder the user picked', () => {
  it('answers with the coordinate the directory declares', async () => {
    const probe = await probeElectronExtensionRoot(extensionFolders.ok)
    expect(probe).toMatchObject({ state: 'extension', id: 'org.example/fixture-thirdparty' })
  })

  it('refuses a folder that is not an extension, by name, before anything is written', async () => {
    const probe = await probeElectronExtensionRoot(extensionFolders.junk)
    expect(probe.state).toBe('refused')
    if (probe.state !== 'refused') return
    // The loader's own words: the page shows this verbatim rather than "could not add folder".
    expect(probe.code).toBe('x3.host/extension-not-an-extension')
    expect(probe.message).toContain('modkit.extension.json')
  })

  it('refuses a coordinate something already loaded, rather than shadowing it', async () => {
    const probe = await probeElectronExtensionRoot(extensionFolders.ok, [
      'org.example/fixture-thirdparty',
    ])
    expect(probe).toMatchObject({ state: 'refused', code: 'x3.host/extension-coordinate-conflict' })
  })

  it('names a directory that does not exist instead of throwing', async () => {
    const probe = await probeElectronExtensionRoot(join(extensionFolders.ok, 'nowhere'))
    expect(probe.state).toBe('refused')
  })
})

describe('the settings document carries the disabled set', () => {
  it('normalizes a hand-edited list into a sorted, deduplicated set and round-trips it', () => {
    const { document, problems } = normalizeSettings({
      schemaVersion: 1,
      disabledContributions: ['org.example/z', 'org.example/a', 'org.example/a', 7],
    })
    expect(document.disabledContributions).toEqual(['org.example/a', 'org.example/z'])
    expect(problems.join(' ')).toContain('disabledContributions[3]')
    // canonical bytes: the same choice written by two hosts produces the same file
    expect(normalizeSettings(JSON.parse(serializeSettings(document))).document).toEqual(document)
  })

  it('treats an absent list as "nothing is switched off", with no complaint', () => {
    const { document, problems } = normalizeSettings({ schemaVersion: 1 })
    expect(document.disabledContributions).toEqual([])
    expect(problems).toEqual([])
  })
})

describe('what the codecs section lists', () => {
  it('keeps a switched-off codec listed, without activation and with the host reason', async () => {
    const services = await createElectronSubjectServices([imagesExtension], {
      disabledContributions: [PNG_CODEC],
    })
    const rows = describeInventoryContributions(services.application.main.inventory)
    const png = rows.find(row => row.id === PNG_CODEC)
    if (png === undefined) throw new Error('the disabled codec vanished from the inventory')
    expect(png).toMatchObject({
      disabled: true,
      activationEligible: false,
      contract: 'org.modkitx/codec-contribution',
      extension: 'org.modkitx/images',
      origin: 'bundled',
    })
    expect(png.displayName.length).toBeGreaterThan(0)

    // …and every other codec of the same extension is untouched: the switch is per contribution.
    const others = rows.filter(row => row.id !== PNG_CODEC && row.contract !== undefined)
    expect(others.length).toBeGreaterThan(0)
    expect(others.every(row => !row.disabled)).toBe(true)

    // sorted by owner then id, so the page draws the same order on every launch
    const keys = rows.map(row => `${row.extension}\u0000${row.id ?? row.path}`)
    expect(keys).toEqual([...keys].sort())
  }, 30_000)

  it('answers the "why did nothing claim this file" question with the host diagnostic', async () => {
    const services = await createElectronSubjectServices([imagesExtension], {
      disabledContributions: [PNG_CODEC],
    })
    const inventory = services.application.main.inventory
    const notices = disabledContributionNotices(inventory, 'C:/somewhere/portrait.PNG')
    expect(notices.map(item => item.code)).toEqual([CONTRIBUTION_DISABLED_CODE])
    expect(notices[0]?.message).toContain(PNG_CODEC)
    // a format the switched-off codec never declared gets no notice at all
    expect(disabledContributionNotices(inventory, 'C:/somewhere/notes.txt')).toEqual([])
    expect(disabledContributionNotices(inventory, 'C:/somewhere/no-extension')).toEqual([])
  }, 30_000)

  it('lists everything as active when nothing is switched off', async () => {
    const services = await createElectronSubjectServices([imagesExtension])
    const rows = describeInventoryContributions(services.application.main.inventory)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some(row => row.disabled)).toBe(false)
    expect(disabledContributionNotices(services.application.main.inventory, 'a.png')).toEqual([])
  }, 30_000)
})

describe('a folder the user connected reaches the inventory', () => {
  it('loads it as an installed artifact, beside the bundled catalog', async () => {
    const services = await createElectronSubjectServices([imagesExtension], {
      userRoots: [{ root: extensionFolders.ok }],
    })
    expect(services.extensions.installed).toEqual(['org.example/fixture-thirdparty'])
    expect(services.extensions.failures).toEqual([])
    const rows = describeInventoryContributions(services.application.main.inventory)
    expect(rows.find(row => row.id === 'org.example/fixture-thirdparty')).toMatchObject({
      origin: 'installed',
      contract: 'org.modkitx/codec-contribution',
    })
    // its declared format is offered by the picker hints, so the app can say it can open it
    expect(services.supportedExtensions).toContain('mkfixture')
  }, 30_000)

  it('reports a broken folder as a record and still loads everything else', async () => {
    const services = await createElectronSubjectServices([imagesExtension], {
      userRoots: [{ root: extensionFolders.junk }, { root: extensionFolders.ok }],
    })
    expect(services.extensions.installed).toEqual(['org.example/fixture-thirdparty'])
    expect(services.extensions.failures).toHaveLength(1)
    expect(services.extensions.failures[0]).toMatchObject({
      root: extensionFolders.junk,
      code: 'x3.host/extension-not-an-extension',
    })
  }, 30_000)
})
