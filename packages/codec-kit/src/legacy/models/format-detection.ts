import type { ModelFormat } from '../../legacy-model-support.js'
import {
  isBlendFile,
  isColladaDaeXml,
  isDiablo3Appearance,
  isEmperorXbf,
  isGlbBinary,
  isGltfJson,
  isGreyGooAloBinary,
  isMdlText,
  isMdxMagic,
  isPlyModel,
  isRedAlert2Vxl,
  isRelicSgmChunky,
  isRelicWhmChunky,
  isStlModel,
  isSupremeCommanderScm,
  isUnityMeshPayload,
  isUnrealActorXPsa,
  isUnrealActorXPsk,
  isWestwoodW3dBinary,
} from './registry-detectors.js'

export { isMdlText, isMdxMagic, magicString } from './registry-detectors.js'

export function detectModelFormat(bytes: Uint8Array, hint = ''): ModelFormat {
  const normalizedHint = hint.replace(/\\/g, '/').toLowerCase()
  if (/\.(m3)$/i.test(normalizedHint)) return 'm3'
  if (/\.(mdx)$/i.test(normalizedHint)) return 'mdx'
  if (/\.(mdl)$/i.test(normalizedHint)) return 'mdl'
  if (/\.(m2)$/i.test(normalizedHint)) return 'm2'
  if (/\.(sno)$/i.test(normalizedHint)) return 'sno'
  if (/\.(app)$/i.test(normalizedHint)) return 'sno'
  if (/\.(dae)$/i.test(normalizedHint)) return 'dae'
  if (/\.(gltf)$/i.test(normalizedHint)) return 'gltf'
  if (/\.(glb)$/i.test(normalizedHint)) return 'glb'
  if (/\.(stl)$/i.test(normalizedHint)) return 'stl'
  if (/\.(ply)$/i.test(normalizedHint)) return 'ply'
  if (/\.(blend)$/i.test(normalizedHint)) return 'blend'
  if (/\.(w3x)$/i.test(normalizedHint)) return 'w3x'
  if (/\.(w3d)$/i.test(normalizedHint)) return 'w3d'
  if (/\.(pie)$/i.test(normalizedHint)) return 'pie'
  if (/\.(vxl)$/i.test(normalizedHint)) return 'vxl'
  if (/\.(scm)$/i.test(normalizedHint)) return 'scm'
  if (/\.(whm)$/i.test(normalizedHint)) return 'whm'
  if (/\.(sgm)$/i.test(normalizedHint)) return 'sgm'
  if (/\.(alo|ala)$/i.test(normalizedHint)) return 'alo'
  if (/\.(xbf)$/i.test(normalizedHint)) return 'xbf'
  if (/\.(kfr)$/i.test(normalizedHint)) return 'kfr'
  if (/\.(std)$/i.test(normalizedHint)) return 'std'
  if (/\.(skn)$/i.test(normalizedHint)) return 'skn'
  if (/\.(bns)$/i.test(normalizedHint)) return 'bns'
  if (/\.(mot)$/i.test(normalizedHint)) return 'mot'
  if (/\.(unitymesh)$/i.test(normalizedHint)) return 'unitymesh'
  if (/\.(psk|pskx)$/i.test(normalizedHint)) return 'psk'
  if (/\.(psa)$/i.test(normalizedHint)) return 'psa'
  if (/\.(uasset|uexp|ubulk|usmap)$/i.test(normalizedHint)) return 'uasset'

  // `m3` and `m2` have no content check here on purpose. Recognising them meant importing a
  // detector out of the codec that owns it — one from an extension, one from `codecs/` — which is
  // the coupling this package is shedding, and it was the last thing making a game-neutral package
  // hard-require StarCraft II. Their filename hints above still route them, and content detection
  // for both now comes from the codec's own `detect` entrypoint through `matchCatalog()`.
  if (isMdxMagic(bytes)) return 'mdx'
  if (isMdlText(bytes)) return 'mdl'
  if (isDiablo3Appearance(bytes)) return 'sno'
  if (isColladaDaeXml(bytes)) return 'dae'
  if (isGlbBinary(bytes)) return 'glb'
  if (isGltfJson(bytes)) return 'gltf'
  if (isStlModel(bytes)) return 'stl'
  if (isPlyModel(bytes)) return 'ply'
  if (isBlendFile(bytes)) return 'blend'
  // `.pie` has no content sniff here: its detector belongs to the codec, in an extension this
  // package may not link. The filename hint above still recognises it, being a naming convention
  // rather than format knowledge.
  if (isRedAlert2Vxl(bytes)) return 'vxl'
  if (isSupremeCommanderScm(bytes)) return 'scm'
  if (isRelicSgmChunky(bytes)) return 'sgm'
  if (isRelicWhmChunky(bytes)) return 'whm'
  if (isGreyGooAloBinary(bytes)) return 'alo'
  if (isEmperorXbf(bytes)) return 'xbf'
  if (isWestwoodW3dBinary(bytes)) return 'w3d'
  if (isUnityMeshPayload(bytes)) return 'unitymesh'
  if (isUnrealActorXPsk(bytes)) return 'psk'
  if (isUnrealActorXPsa(bytes)) return 'psa'
  return 'unknown'
}
