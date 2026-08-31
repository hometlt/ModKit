export { uvModule } from './module.js'

export { MATERIALIZER_COORDINATE, materializeUvmCore, packUvmGlb } from './model/materializer.js'
export { writerModule as uvmWriterModule } from './model/writer.js'

export {
  TEXTURE_MATERIALIZER_COORDINATE,
  materializeUvtCore,
  packUvtKtx2,
} from './texture/materializer.js'
export { writerModule as uvtWriterModule } from './texture/writer.js'

export const contributionManifests = Object.freeze(['./contributions/*.json'])
