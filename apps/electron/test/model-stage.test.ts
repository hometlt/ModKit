import { describe, expect, it, vi } from 'vitest'
import type { SceneRendererPort } from '@modkit/sdk'

const proof = vi.hoisted(() => ({
  module: Object.freeze({ mount: vi.fn() }),
  options: [] as unknown[],
}))

vi.mock('../generated/viewer-catalog.js', () => ({
  PREVIEW_STAGES: Object.freeze([
    Object.freeze({
      id: 'model',
      label: 'Model',
      contract: 'common.view/model-scene-source',
      module: Object.freeze({ mount: vi.fn() }),
    }),
  ]),
  PREVIEW_STAGES_READONLY: Object.freeze([
    Object.freeze({
      id: 'model',
      label: 'Model',
      contract: 'common.view/model-scene-source',
      module: Object.freeze({ mount: vi.fn() }),
    }),
  ]),
  createPreviewStages: () => [],
  createPreviewStagesReadonly: () => [],
}))

vi.mock('@modkit/ui/model', () => ({
  createModelViewer: (options: unknown) => {
    proof.options.push(options)
    return proof.module
  },
}))

import { createElectronReadOnlyStages, createElectronStages } from '../src/stages.js'

describe('Electron model stage composition', () => {
  it('replaces both generated model stages with the host-configured renderer and textures', () => {
    const renderer = Object.freeze({ acquire: vi.fn() }) as unknown as SceneRendererPort
    const textures = vi.fn()
    const options = {
      operationsFor: async () => undefined,
      renderer,
      textures,
    }

    const editable = createElectronStages(options)
    const readonly = createElectronReadOnlyStages(options)

    expect(editable.find(stage => stage.id === 'model')?.module).toBe(proof.module)
    expect(readonly.find(stage => stage.id === 'model')?.module).toBe(proof.module)
    expect(proof.options).toEqual([
      { renderer, textures },
      { renderer, textures },
    ])
  })
})
