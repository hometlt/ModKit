import { describe, expect, it } from 'vitest'
import type { PresentationSlot, SubjectFactsSource, ViewerModule } from '@modkit/sdk'
import { embedRelationGraph, relatedModelStageInputs } from '../src/card/index.js'
import { DEFAULT_UI_LOCALIZER } from '../src/localization/index.js'
import { ViewerMountScope } from '../src/viewer/index.js'

const scene = { info: async () => ({ nodes: 1, meshes: 1, primitives: 1, materials: 0, animations: 0 }) }

describe('subject card related model', () => {
  it('binds the model stage to the host-lent model leases, dropping only missing facets', async () => {
    const released: string[] = []
    const source = {
      openModel: async () => ({ value: scene, release: async () => void released.push('scene') }),
      openModelMaterials: async () => {
        throw new TypeError('the converted model does not publish this facet')
      },
    } as unknown as SubjectFactsSource
    const { slot, sources } = relatedModelStageInputs(
      source,
      { slotId: 'card', bindings: [] } as unknown as PresentationSlot,
      new AbortController().signal,
    )
    const contracts = slot.bindings.map(binding => ('contract' in binding ? binding.contract : ''))
    expect(contracts).toEqual([
      'common.view/model-scene-source',
      'common.view/model-material-source',
      'common.view/model-resource-refs-source',
    ])
    const [sceneBinding, materialBinding, referenceBinding] = slot.bindings as never[]
    const lease = await sources.get(sceneBinding!)
    expect(lease?.value).toBe(scene)
    await lease?.release()
    expect(released).toEqual(['scene'])
    await expect(sources.get(materialBinding!)).resolves.toBeUndefined()
    await expect(sources.get(referenceBinding!)).resolves.toBeUndefined()
  })

  it('surfaces a scene that did not resolve instead of an empty stage', async () => {
    const source = {
      openModel: async () => {
        throw new TypeError('resource «Assets/x.m3» is not in any scope this session serves')
      },
    } as unknown as SubjectFactsSource
    const { slot, sources } = relatedModelStageInputs(
      source,
      { slotId: 'card', bindings: [] } as unknown as PresentationSlot,
      new AbortController().signal,
    )
    await expect(sources.get(slot.bindings[0] as never)).rejects.toThrow(/not in any scope/u)
  })

  it('shows the relations graph, walked from the subject, in a collapsed section', async () => {
    const scope = new ViewerMountScope()
    const mounts: { container: unknown; slot: unknown }[] = []
    let unmounted = false
    const graph = {
      abiVersion: 1,
      async mount(args: { container: unknown; slot: unknown }) {
        mounts.push(args)
        return { unmount: () => void (unmounted = true) }
      },
    } as unknown as ViewerModule
    type MountArgs = Parameters<ViewerModule['mount']>[0]
    const unbound = { slot: { slotId: 'card', bindings: [] } } as unknown as MountArgs
    expect(embedRelationGraph([], unbound, scope, DEFAULT_UI_LOCALIZER, graph)).toEqual([])

    const slot = {
      slotId: 'card',
      bindings: [{ bindingId: 'graph', contract: 'common.view/relation-graph-source', major: 1 }],
    }
    const [section] = embedRelationGraph(
      [],
      { slot } as unknown as MountArgs,
      scope,
      DEFAULT_UI_LOCALIZER,
      graph,
    )
    expect(section).toMatchObject({
      kind: 'custom',
      id: 'relations-graph',
      title: 'Relations graph',
      expanded: false,
    })
    // nothing is walked until the section opens
    expect(mounts).toEqual([])
    const host = { dataset: {}, setAttribute() {} } as unknown as HTMLElement
    if (section?.kind === 'custom') await section.render(host)
    expect(mounts).toMatchObject([{ container: host, slot }])
    await scope.close()
    expect(unmounted).toBe(true)
  })
})
