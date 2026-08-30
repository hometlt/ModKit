import { subjectFactsSourceFromWire } from '@modkitx/extension-manager'
import type { Inventory } from '@modkitx-x3/host'
import { loadSubjectCardSections } from '@modkitx-x3/ui/card'
import { beforeAll, describe, expect, it } from 'vitest'

import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import {
  createWebExtensionSubjectCatalog,
  webExtensionSubjectCardBundle,
} from '../src/extension-subjects.js'
import { createWebApp } from '../src/index.js'
import { catalogToExtensionInputs } from '../src/subjects.js'

let inventory: Inventory

beforeAll(async () => {
  const app = await createWebApp(
    { operatingSystem: 'linux', architecture: 'x64' },
    catalogToExtensionInputs(WEB_EXTENSION_CATALOG, 'https://modkit.example/app/'),
  )
  inventory = app.main.inventory
})

describe('web extension subjects', () => {
  it('shows authored contributions grouped by the exact contract coordinate', () => {
    const catalog = createWebExtensionSubjectCatalog(inventory)
    const entry = catalog.entries.find(candidate => candidate.projection.contributions.length > 1)
    expect(entry).toBeDefined()
    expect(entry?.projection.contractGroups.length).toBeGreaterThan(0)

    const contributions = entry?.projection.contractGroups.flatMap(group => {
      expect(group.key).toBe(`${group.contract.id}@${group.contract.major}`)
      expect(group.key).not.toBe('codec')
      return group.contributions
    })
    expect(contributions?.map(item => item.id).sort()).toEqual(
      entry?.projection.contributions.map(item => item.id).sort(),
    )
  })

  it('round-trips cards through the inert wire source with extension/contribution navigation', async () => {
    const catalog = createWebExtensionSubjectCatalog(inventory)
    const entry = catalog.entries.find(candidate => candidate.projection.contributions.length > 0)
    const contribution = entry?.projection.contributions[0]
    expect(entry).toBeDefined()
    expect(contribution).toBeDefined()
    if (entry === undefined || contribution === undefined) return

    const bundle = await webExtensionSubjectCardBundle(entry, contribution.subjectId)
    const documents = new Map(
      bundle.documents.map(document => [document.subject.subjectId, document]),
    )
    const contributionDocument = documents.get(contribution.subjectId)
    const extensionDocument = documents.get(entry.projection.extension.subjectId)
    expect(contributionDocument?.relations).toContainEqual(
      expect.objectContaining({
        role: 'belongs-to',
        subjectId: entry.projection.extension.subjectId,
      }),
    )
    expect(extensionDocument?.relations).toContainEqual(
      expect.objectContaining({ role: 'owns', subjectId: contribution.subjectId }),
    )
    if (contributionDocument === undefined) return
    const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(contributionDocument))
    expect(sections[0]).toMatchObject({ kind: 'header', title: contribution.displayName })
    expect(sections.some(section => section.kind === 'links')).toBe(true)
  })

  it('uses the portable contribution switch and browser package switch without hiding subjects', () => {
    const original = inventory.extensions.find(extension =>
      extension.contributions.some(contribution => contribution.manifest !== undefined),
    )
    const contributionId = original?.contributions.find(item => item.manifest !== undefined)
      ?.manifest?.id
    expect(original).toBeDefined()
    expect(contributionId).toBeDefined()
    if (original === undefined || contributionId === undefined) return

    const packageId = 'org.example/browser-suite'
    const extensionId = `${original.manifest.publisher}/${original.manifest.id}`
    const managedInventory: Inventory = Object.freeze({
      ...inventory,
      extensions: Object.freeze([
        Object.freeze({ ...original, source: `managed-package/${packageId}@1.0.0` }),
      ]),
    })
    const catalog = createWebExtensionSubjectCatalog(managedInventory, {
      disabledExtensions: [extensionId],
      disabledContributions: [contributionId],
      managedPackageByExtension: {
        [extensionId]: packageId,
      },
      managedPackageEnablement: { [packageId]: true },
    })
    const entry = catalog.entries[0]
    const contribution = entry?.projection.contributions.find(item => item.id === contributionId)
    expect(entry?.managedPackageId).toBe(packageId)
    expect(entry?.configuredEnabled).toBe(false)
    expect(entry?.projection.extension.enabled).toBe(false)
    expect(contribution).toMatchObject({ enabled: false, effectiveEnabled: false })
    expect(entry?.projection.contributions).toHaveLength(
      original.contributions.filter(item => item.manifest !== undefined).length,
    )

    const parentDisabled = createWebExtensionSubjectCatalog(managedInventory, {
      managedPackageByExtension: { [extensionId]: packageId },
      managedPackageEnablement: { [packageId]: false },
    }).entries[0]
    expect(parentDisabled).toMatchObject({ configuredEnabled: true })
    expect(parentDisabled?.projection.extension.enabled).toBe(false)
  })
})
