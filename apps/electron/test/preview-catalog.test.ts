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
import { COMMON_PRESENTATION_CATALOG } from '@modkit/host'

import { APP_STAGE_POLICY, STAGE_ORDER } from '../src/view-policy.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const presentation = COMMON_PRESENTATION_CATALOG.map(entry => entry.slot)
/**
 * Stages the shared catalog emits that Electron does not compose yet. The owner's order puts
 * Electron after the accepted VS Code plugin, so the mod wiki (plan 5.25) is a VS Code and web
 * stage for now; left out of `STAGE_ORDER`, it is never offered here.
 */
const DEFERRED_STAGES: readonly string[] = ['wiki']
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
    join(repositoryRoot, 'packages', 'code', 'contributions'),
  ]
  return directories.flatMap(directory =>
    readdirSync(directory)
      .filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')) as ViewerManifest)
      .filter(manifest => manifest.contract?.id === 'modkit/viewer-contribution'),
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
    for (const slot of presentation) {
      if (DEFERRED_STAGES.includes(slot.slotId)) expect(STAGE_ORDER).not.toContain(slot.slotId)
      else expect(STAGE_ORDER).toContain(slot.slotId)
    }
    for (const policy of APP_STAGE_POLICY) expect(STAGE_ORDER).toContain(policy.id)
  })

  it('carries the stages the ui package ships that had no contribution to name', () => {
    // The archive has a shared stage contribution for host planning, but Electron still composes
    // its richer application adapter; image editing is application-only.
    expect(APP_STAGE_POLICY.map(policy => policy.id).sort()).toEqual(['archive', 'image-edit'])
    const kinds = new Map(viewerManifests().map(manifest => [manifest.id, manifest.spec?.kind]))
    expect(kinds.get('modkit.ui/namespace-tree')).toBe('tree')
    expect(kinds.get('modkit.ui/archive-stage')).toBe('stage')
  })

  it('binds each slot to exactly one data source, shared by both catalogs', () => {
    // The archive is composed by each app, and a deferred stage has no Electron module to bind.
    const bound = presentation.filter(
      slot => slot.slotId !== 'archive' && !DEFERRED_STAGES.includes(slot.slotId),
    )
    for (const slot of bound) {
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
