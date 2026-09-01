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
import type { Inventory } from '@modkit/host'
import { normalizeSettings, serializeSettings } from '@modkit/ui/settings'
import { subjectFactsSourceFromWire } from '@modkit/extension-manager'

import {
  createElectronSubjectServices,
  describeInventoryContributions,
  describeInventoryExtensionSubjects,
  disabledContributionNotices,
  probeElectronExtensionRoot,
  CONTRIBUTION_DISABLED_CODE,
} from '../src/index.js'
import {
  createExtensionOperationLifecycle,
  disabledContributionCount,
  groupContributionsByContract,
  readExtensionOperationMarker,
  waitForExtensionOperation,
  withContributionEnabled,
  withExtensionEnabled,
  type ContributionReport,
} from '../src/extensions-page.js'
import { createElectronLocalizer } from '../src/localization.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const imagesExtension = join(repositoryRoot, 'extensions', 'images')
const PNG_CODEC = 'modkit/image-png'

describe('locale-independent extension operation lifecycle', () => {
  it('completes RU toggle, add refusal, failure and remove probes without reading status text', async () => {
    const localizer = createElectronLocalizer('ru')
    expect(localizer.locale).toBe('ru')
    const russianStatusCopy = [
      localizer.text('electron.extensions.applied', { what: 'переключение', summary: 'готово' }),
      localizer.text('electron.extensions.failed', { what: 'переключение', reason: 'отказ' }),
      localizer.text('electron.extensions.notAddedStatus', {
        root: 'папка',
        code: 'x3.host/refused',
        message: 'отказ',
      }),
    ]
    expect(russianStatusCopy.every(text => /[а-я]/iu.test(text))).toBe(true)

    const lifecycle = createExtensionOperationLifecycle()
    const markerSource = {
      querySelector() {
        const marker = lifecycle.marker
        return {
          getAttribute(name: string) {
            if (name === 'data-operation-revision') return String(marker.revision)
            if (name === 'data-operation-state') return marker.state
            return null
          },
        }
      },
    }
    const scenarios = [
      { action: 'toggle', terminal: 'applied' },
      { action: 'add refusal', terminal: 'refused' },
      { action: 'toggle failure', terminal: 'failed' },
      { action: 'remove', terminal: 'applied' },
    ] as const

    for (const [index, scenario] of scenarios.entries()) {
      const before = lifecycle.marker.revision
      const revision = lifecycle.begin()
      expect(revision, scenario.action).toBe(index + 1)
      expect(readExtensionOperationMarker(markerSource), scenario.action).toEqual({
        revision,
        state: 'busy',
      })
      const completion = waitForExtensionOperation(
        () => readExtensionOperationMarker(markerSource),
        before,
        { attempts: 10, intervalMs: 0 },
      )
      queueMicrotask(() => {
        if (revision !== undefined) lifecycle.finish(revision, scenario.terminal)
      })
      await expect(completion, scenario.action).resolves.toEqual({
        revision,
        state: scenario.terminal,
      })
    }
  })
})

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

  it('changes enablement by stable id without accepting or replacing a filesystem root', () => {
    const document = normalizeSettings({
      schemaVersion: 1,
      extensions: [
        { id: 'org.example/first', path: 'C:/fixed/first', enabled: true },
        { id: 'org.example/second', path: 'C:/fixed/second', enabled: true },
      ],
      disabledContributions: ['org.example/already-off'],
    }).document
    const disabled = withExtensionEnabled(document, 'org.example/first', false)
    expect(disabled.extensions).toEqual([
      { id: 'org.example/first', path: 'C:/fixed/first', enabled: false },
      { id: 'org.example/second', path: 'C:/fixed/second', enabled: true },
    ])
    expect(disabled.disabledExtensions).toEqual(['org.example/first'])
    const bundledOff = withExtensionEnabled(document, 'org.example/bundled', false)
    expect(bundledOff.extensions).toEqual(document.extensions)
    expect(bundledOff.disabledExtensions).toEqual(['org.example/bundled'])

    const contributionOff = withContributionEnabled(disabled, 'org.example/codec', false)
    expect(contributionOff.disabledContributions).toEqual([
      'org.example/already-off',
      'org.example/codec',
    ])
    expect(withContributionEnabled(contributionOff, 'org.example/codec', true)).toMatchObject({
      extensions: disabled.extensions,
      disabledContributions: ['org.example/already-off'],
    })
  })
})

describe('extension enablement summary', () => {
  it('counts direct and owner-level disabled contributions', () => {
    const contribution = (overrides: Partial<ContributionReport>): ContributionReport => ({
      id: 'org.example/codec',
      displayName: 'Fixture codec',
      extension: 'org.example/fixture',
      origin: 'installed',
      activationEligible: false,
      disabled: false,
      extensionDisabled: false,
      path: 'fixture.json',
      ...overrides,
    })
    expect(
      disabledContributionCount([
        contribution({ disabled: true }),
        contribution({ extensionDisabled: true }),
        contribution({}),
      ]),
    ).toBe(2)
  })
})

describe('contribution contract groups', () => {
  it('uses exact contract.id@major coordinates and never invents codec entities', () => {
    const contribution = (
      id: string,
      contract: string | undefined,
      contractMajor: number | undefined,
    ): ContributionReport => ({
      id,
      displayName: id,
      ...(contract === undefined ? {} : { contract }),
      ...(contractMajor === undefined ? {} : { contractMajor }),
      extension: 'org.example/extension',
      origin: 'bundled',
      activationEligible: true,
      disabled: false,
      extensionDisabled: false,
      path: `${id}.json`,
    })
    const groups = groupContributionsByContract([
      contribution('org.example/codec-v2', 'modkit/codec-contribution', 2),
      contribution('org.example/viewer', 'modkit/viewer-contribution', 1),
      contribution('org.example/codec-v1', 'modkit/codec-contribution', 1),
      contribution('org.example/unreadable', undefined, undefined),
    ])
    expect(groups.map(group => group.key)).toEqual([
      'modkit/codec-contribution@1',
      'modkit/codec-contribution@2',
      'modkit/viewer-contribution@1',
      undefined,
    ])
    expect(groups.flatMap(group => group.contributions.map(item => item.id))).toEqual([
      'org.example/codec-v1',
      'org.example/codec-v2',
      'org.example/viewer',
      'org.example/unreadable',
    ])
  })
})

describe('what the codecs section lists', () => {
  it('keeps an explicitly disabled zero-contribution extension visible as a disabled card', async () => {
    const coordinate = 'org.example/empty'
    const inventory: Inventory = {
      extensions: [
        {
          source: 'fixture-empty',
          origin: 'installed',
          container: 'package-json',
          manifest: {
            schemaVersion: 1,
            publisher: 'org.example',
            id: 'empty',
            version: '1.0.0',
            license: 'MIT',
            contributionManifests: [],
          },
          contributions: [],
        },
      ],
      diagnostics: [],
    }
    const documents = await describeInventoryExtensionSubjects(inventory, [coordinate])
    expect(documents).toHaveLength(1)
    expect(documents[0]?.subject).toMatchObject({
      kind: 'modkit/extension',
      id: coordinate,
      enabled: false,
    })
    expect(documents[0]?.relations).toEqual([])
  })

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
      contract: 'modkit/codec-contribution',
      extension: 'modkit/images',
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

    const documents = await describeInventoryExtensionSubjects(services.application.main.inventory)
    const extension = documents.find(
      document =>
        document.subject.kind === 'modkit/extension' && document.subject.id === 'modkit/images',
    )
    const pngCard = documents.find(
      document =>
        document.subject.kind === 'modkit/contribution' && document.subject.id === PNG_CODEC,
    )
    expect(extension).toBeDefined()
    expect(pngCard?.subject).toMatchObject({
      contractKey: 'modkit/codec-contribution@1',
      enabled: false,
      effectiveEnabled: false,
    })
    if (extension === undefined || pngCard === undefined) return
    const extensionRelations = await subjectFactsSourceFromWire(extension).relations({ limit: 256 })
    const contributionRelations = await subjectFactsSourceFromWire(pngCard).relations({
      limit: 256,
    })
    expect(extensionRelations.items).toContainEqual(
      expect.objectContaining({ role: 'owns', subjectId: pngCard.subject.subjectId }),
    )
    expect(contributionRelations.items).toEqual([
      expect.objectContaining({ role: 'belongs-to', subjectId: extension.subject.subjectId }),
    ])
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
      contract: 'modkit/codec-contribution',
    })
    // its declared format is offered by the picker hints, so the app can say it can open it
    expect(services.supportedExtensions).toContain('mkfixture')
  }, 30_000)

  it('keeps a disabled extension and its cards inventoried while every contribution is inactive', async () => {
    const coordinate = 'org.example/fixture-thirdparty'
    const services = await createElectronSubjectServices([imagesExtension], {
      userRoots: [{ root: extensionFolders.ok }],
      disabledExtensions: [coordinate],
    })
    expect(services.extensions.installed).toContain(coordinate)
    const rows = describeInventoryContributions(services.application.main.inventory).filter(
      row => row.extension === coordinate,
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(
      rows.every(row => row.extensionDisabled && !row.disabled && !row.activationEligible),
    ).toBe(true)

    const documents = await describeInventoryExtensionSubjects(
      services.application.main.inventory,
      [coordinate],
    )
    const extension = documents.find(document => document.subject.id === coordinate)
    const contributions = documents.filter(document => document.subject.extensionId === coordinate)
    expect(extension?.subject).toMatchObject({
      kind: 'modkit/extension',
      id: coordinate,
      enabled: false,
    })
    expect(contributions.length).toBeGreaterThan(0)
    expect(
      contributions.every(
        document =>
          document.subject.enabled === true && document.subject.effectiveEnabled === false,
      ),
    ).toBe(true)
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
