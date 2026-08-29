/**
 * Coverage of the generated Electron preview catalogs.
 *
 * The point of A1 is that no first-party viewer stays unmountable by accident. A contribution
 * manifest is data, so that is checkable: every `stage` contribution the UI packages ship must be
 * named by the app policy in `scripts/emit-app-catalogs.mjs`, every emitted stage must be ranked
 * in `STAGE_ORDER`, and the two catalogs must agree on the slot set. A new stage contribution that
 * nobody wired therefore fails here rather than silently never appearing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMON_PRESENTATION_CATALOG } from '@modkitx-x3/host'

import { APP_STAGE_POLICY, STAGE_ORDER } from '../src/view-policy.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const presentation = COMMON_PRESENTATION_CATALOG.map(entry => entry.slot)
const viewerCatalogSource = readFileSync(
  join(repositoryRoot, 'apps', 'electron', 'generated', 'viewer-catalog.js'),
  'utf8',
)

interface ViewerManifest {
  readonly id: string
  readonly contract?: { readonly id?: string; readonly major?: number }
  readonly spec?: {
    readonly kind?: string
    readonly consumesDataSources?: readonly { readonly contract: string }[]
  }
}

function viewerManifests(): readonly ViewerManifest[] {
  const directories = [
    join(repositoryRoot, 'packages', 'ui', 'contributions'),
    join(repositoryRoot, 'extensions', 'common', 'ui-monaco', 'contributions'),
  ]
  return directories.flatMap(directory =>
    readdirSync(directory)
      .filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')) as ViewerManifest)
      .filter(manifest => manifest.contract?.id === 'org.modkitx/viewer-contribution'),
  )
}

describe('the Electron preview policy', () => {
  it('names every first-party stage contribution', () => {
    const stages = viewerManifests()
      .filter(manifest => manifest.spec?.kind === 'stage')
      .map(manifest => manifest.id)
      .sort()
    const selected = presentation
      .filter(slot => slot.kind === 'stage')
      .map(slot => slot.contributionId)
      .sort()
    expect(selected).toEqual(stages)
  })

  it('ranks every emitted slot, and every app-composed stage, in the picker order', () => {
    for (const slot of presentation) expect(STAGE_ORDER).toContain(slot.slotId)
    for (const policy of APP_STAGE_POLICY) expect(STAGE_ORDER).toContain(policy.id)
  })

  it('carries the stages the ui package ships that had no contribution to name', () => {
    // The archive has a shared stage contribution for host planning, but Electron still composes
    // its richer application adapter; image editing is application-only.
    expect(APP_STAGE_POLICY.map(policy => policy.id).sort()).toEqual(['archive', 'image-edit'])
    const kinds = new Map(viewerManifests().map(manifest => [manifest.id, manifest.spec?.kind]))
    expect(kinds.get('org.modkitx.ui/namespace-tree')).toBe('tree')
    expect(kinds.get('org.modkitx.ui/archive-stage')).toBe('stage')
  })

  it('binds each slot to exactly one data source, shared by both catalogs', () => {
    for (const slot of presentation.filter(slot => slot.slotId !== 'archive')) {
      if (slot.slotId === 'template') {
        expect(slot.bindings).toHaveLength(0)
        expect(viewerCatalogSource).toContain("operation: 'view.template'")
        continue
      }
      expect(slot.bindings).toHaveLength(1)
      const binding = slot.bindings[0]
      expect(binding).toBeDefined()
      const contract = binding !== undefined && 'contract' in binding ? binding.contract : ''
      expect(viewerCatalogSource).toContain(`contract: '${contract}'`)
    }
  })

  it('keeps the media stages, which is what A1 added', () => {
    const slots = presentation.map(slot => slot.slotId)
    for (const added of ['audio', 'video', 'model', 'vector', 'virtual-text']) {
      expect(slots).toContain(added)
    }
  })
})
