// Bounded diagnostics over the saved, dependency-resolved Amphion world payload.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
const dir = '../artifacts/water-effects/world'
mkdirSync(dir, { recursive: true })
const bundled = await build({ entryPoints: ['packages/scene/src/world/webgl.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const modulePath = `${dir}/plan.mjs`
writeFileSync(modulePath, bundled.outputFiles[0].text)
const { createWorldWebGlPlan } = await import(pathToFileURL(new URL(modulePath, pathToFileURL(process.cwd() + '/')).pathname.replace(/^\/(?=[A-Za-z]:)/u, '')).href)
const bytes = readFileSync('../artifacts/lighting/payload-complete/world.bin')
const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const constructors = { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView }
const revive = value => {
  if (Array.isArray(value)) return value.map(revive)
  if (value === null || typeof value !== 'object') return value
  if ('$bigint' in value) return BigInt(value.$bigint)
  if ('$map' in value) return new Map(value.$map.map(([k, v]) => [k, revive(v)]))
  if ('$typed' in value) {
    const Constructor = constructors[value.$typed]
    return Constructor === DataView ? new DataView(binary, value.offset, value.byteLength) : new Constructor(binary.slice(value.offset, value.offset + value.byteLength))
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]))
}
const payload = revive(JSON.parse(readFileSync('../artifacts/lighting/payload-complete/world.json', 'utf8')))
const evidence = []
for (const [id, model] of payload.models) {
  if (!/Elsecaro_Waves$|CompoundSewers_Water_Effects~/u.test(id)) continue
  const placed = payload.items.filter(item => item.facet === 'objects' && item.resourceId === id)
  const summary = (model, timeSeconds) => {
    const plan = createWorldWebGlPlan({ ...payload, items: [placed[0]], models: new Map([[id, model]]), timeSeconds })
    return { timeSeconds, materialScenes: plan.modelMaterialScenes.map(scene => ({
      primitiveMaterials: scene.primitives.map(x => x.materialId),
      programs: [...scene.programs].map(([id, x]) => ({ id, passes: x.passes.map(x => ({ blend: x.blend, alpha1Multiply: x.uniforms.u_alpha1ColorMultiply, uniforms: Object.fromEntries(Object.entries(x.uniforms).filter(([k]) => /alpha|Offset/iu.test(k))), diagnostics: x.diagnostics })) })),
    })), texturedFallbacks: plan.texturedTriangles.length, transparentFallbacks: plan.transparentTexturedTriangles.length }
  }
  // Preserve the vocabulary version in a COPY to demonstrate the world fallback's cause.
  const corrected = { ...model, materials: model.materials.map(ref => {
    const renderModel = ref.shader?.parameters.renderModel
    if (!renderModel?.composite) return ref
    return { ...ref, shader: { ...ref.shader, parameters: { ...ref.shader.parameters, renderModel: { ...renderModel, standard: renderModel.composite.passes[0].material } } } }
  }) }
  // The world adapter still rewrites a composite, so remove it only in this diagnostic copy.
  for (const ref of corrected.materials) if (ref.shader?.parameters.renderModel.composite) delete ref.shader.parameters.renderModel.composite
  evidence.push({ id, instances: placed.length, hasActorAnimation: !!placed[0].presentationAnimation,
    baseline: [0, 2].map(time => summary(model, time)), versionPreservedSurface: summary(corrected, 2) })
}
writeFileSync(`${dir}/receipt.json`, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence))
