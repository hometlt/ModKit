import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { comparableMetadataFeatures } from './classify.mjs'

const request = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'))
const moduleUrl = pathToFileURL(resolve(request.canonicalRoot, request.canonicalModule)).href
const imported = await import(moduleUrl)
const candidate = imported[request.canonicalExport]
if (candidate === undefined) {
  throw new TypeError(`canonical export is missing: ${request.canonicalExport}`)
}
const codec = request.canonicalFactory === true ? candidate() : candidate
if (typeof codec?.parse !== 'function') throw new TypeError('canonical model codec has no parse()')
const model = await codec.parse(new Uint8Array(await readFile(request.file)), request.file)
const primitiveCount = Array.isArray(model.meshes)
  ? model.meshes.reduce((total, mesh) => total + (mesh?.positions?.length > 0 ? 1 : 0), 0)
  : 0
const summary = {
  scenes: Number.isSafeInteger(model.metadata?.sceneCount) ? model.metadata.sceneCount : 1,
  nodes: Number.isSafeInteger(model.metadata?.nodeCount) ? model.metadata.nodeCount : 0,
  meshes: Array.isArray(model.meshes) ? model.meshes.length : 0,
  primitives: primitiveCount,
  materials: Array.isArray(model.materials) ? model.materials.length : 0,
  textures: Array.isArray(model.metadata?.textures) ? model.metadata.textures.length : 0,
  animations: Array.isArray(model.animations) ? model.animations.length : 0,
}
const geometry = Array.isArray(model.meshes)
  ? model.meshes.some(mesh => mesh?.positions instanceof Float32Array && mesh.positions.length >= 3)
  : false
const firstMesh = Array.isArray(model.meshes) ? model.meshes[0] : undefined
const decodedVertices =
  firstMesh?.positions instanceof Float32Array ? Math.floor(firstMesh.positions.length / 3) : 0
const decodedIndices = firstMesh?.indices?.length ?? 0
const sources = [
  {
    contract: 'common.view/model-scene-source',
    major: 1,
    state: 'opened',
    features: ['info', 'nodes', 'meshes', ...(geometry ? ['primitive'] : [])].sort(),
    measurements: {
      ...summary,
      decodedGeometry: geometry,
      decodedVertices,
      decodedIndices,
    },
  },
]
const features = [
  'source:common.view/model-scene-source',
  ...comparableMetadataFeatures(summary),
  ...(geometry ? ['geometry:decoded'] : []),
].sort()
process.stdout.write(
  `MODKIT_PARITY_RESULT ${JSON.stringify({
    formatId: model.format ?? request.format,
    summary,
    declaredSources: ['common.view/model-scene-source'],
    actualSources: ['common.view/model-scene-source'],
    sources,
    operations: [],
    geometryAccess: geometry ? 'decoded' : 'metadata-only',
    features,
  })}\n`,
)
