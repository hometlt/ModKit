import { build } from 'esbuild'
import { expect, it } from 'vitest'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('bundle metadata is absent')
  return value
}

// A renderer never enters model processing: no frame drawing, no world, no WebGL program.
const RENDERER =
  /^packages\/scene\/src\/(?:render|world)\/|^packages\/scene\/src\/materials\/webgl/u
const SCENE_UVM = [
  'packages/scene/src/uvm/',
  'packages/scene/src/model/',
  'packages/scene/src/materials/',
  'packages/codec-kit/dist/',
  'packages/uv/dist/model/',
] as const

/*
 * Each entry bundles for a neutral platform from its own layer and the built shared packages only.
 * The closures grow with the model contract (billboards, model states, shadow meshes), so the
 * check names the layers a module may come from rather than every module: UI, apps, extensions
 * (format code), the host and anything platform-specific stay out.
 */
for (const [entry, allowed] of [
  ['packages/scene/src/model/index.ts', ['packages/scene/src/model/', 'packages/codec-kit/dist/']],
  ['packages/scene/src/uvm/sockets.ts', SCENE_UVM],
  ['packages/scene/src/uvm/inspection.ts', SCENE_UVM],
  [
    'packages/uv/src/model/validation/index.ts',
    ['packages/uv/src/model/', 'packages/codec-kit/dist/'],
  ],
  ['packages/scene/src/uvm/facets.ts', SCENE_UVM],
  ['packages/scene/src/uvm/model.ts', SCENE_UVM],
  ['packages/scene/src/uvm/index.ts', SCENE_UVM],
] as const) {
  it(`${entry} bundles without platform, UI, renderer or format-specific code`, async () => {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    expect(
      Object.values(required(result.metafile).outputs).flatMap(output => output.imports),
    ).toEqual([])
    const inputs = Object.keys(required(result.metafile).inputs)
    expect(inputs).toContain(entry)
    expect(
      inputs.filter(
        input => RENDERER.test(input) || !allowed.some(prefix => input.startsWith(prefix)),
      ),
    ).toEqual([])
  })
}
