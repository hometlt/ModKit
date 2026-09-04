import path from 'node:path'

export const modelCompatibility = new Set([
  'animation.ts',
  'material.ts',
  'render-contracts.ts',
  'codec.ts',
  'format-detection.ts',
  'registry-detectors.ts',
  'texture-codec.ts',
  'preview-textures.ts',
  'texture-cache.ts',
])

export const modelMath = new Set([
  'animation-controller.ts',
  'color-remap.ts',
  'effects-sim.ts',
  'humanoid.ts',
  'sequence-pose.ts',
  'standard-material-glsl.ts',
  'transport.ts',
  'westwood-bind-pose.ts',
])

export const triggerTmpTest =
  'extensions/blizzard/starcraft-2/codecs/sc2-triggers/src/core/to-engine.e2e.spec.ts.tmp'

const layoutTestSupportPrefix = 'packages/layouts-processing/'

export function isM3TestOwnedSource(file) {
  return (
    /(?:^|\/)test\//u.test(file) ||
    /\.(?:spec|test)\.[cm]?[jt]sx?(?:\.tmp)?$/u.test(file) ||
    /(?:^|\/)fixtures\//u.test(file)
  )
}

export function canonicalM3Destination(source) {
  const extensionPrefix = 'extensions/blizzard/starcraft-2/'
  if (source.startsWith(`${extensionPrefix}codecs/m3/`)) {
    const relative = source.slice(`${extensionPrefix}codecs/m3/`.length)
    const root = isM3TestOwnedSource(source)
      ? 'modkit-extensions-blizzard/models/test/mk2/m3'
      : 'modkit-extensions-blizzard/models/src/lib/mk2/m3'
    return `${root}/${relative}`
  }
  if (source.startsWith(extensionPrefix)) {
    const relative = source.slice(extensionPrefix.length)
    const root = isM3TestOwnedSource(source)
      ? 'modkit-extensions-blizzard/starcraft2/test/mk2'
      : 'modkit-extensions-blizzard/starcraft2/src/lib/mk2'
    return `${root}/${relative}`
  }
  if (source.startsWith('packages/xml/src/'))
    return `modkit-core/packages/codec-kit/src/legacy/xml/${source.slice('packages/xml/src/'.length)}`
  if (source.startsWith('packages/xml/test/'))
    return `modkit-core/packages/codec-kit/test/mk2/xml/${source.slice('packages/xml/test/'.length)}`
  if (source.startsWith('packages/models-processing/src/core/')) {
    const name = source.slice('packages/models-processing/src/core/'.length)
    if (modelCompatibility.has(name))
      return `modkit-core/packages/codec-kit/src/legacy/models/${name}`
    if (modelMath.has(name)) return `modkit-core/packages/codec-kit/src/model-math/${name}`
    return `modkit-core/packages/codec-kit/src/embedded/${name}`
  }
  if (source.startsWith('packages/models-processing/test/core/'))
    return `modkit-core/packages/codec-kit/test/mk2/models-core/${source.slice(
      'packages/models-processing/test/core/'.length,
    )}`
  if (source === 'packages/core/src/events.ts')
    return 'modkit-core/packages/codec-kit/src/legacy/support/events.ts'
  if (source.startsWith('packages/vfs/src/'))
    return `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/${source.slice(
      'packages/vfs/src/'.length,
    )}`
  if (
    source.startsWith(`${layoutTestSupportPrefix}generated/`) ||
    source.startsWith(`${layoutTestSupportPrefix}scripts/`) ||
    source === `${layoutTestSupportPrefix}bundled-schema.js` ||
    source === `${layoutTestSupportPrefix}bundled-schema.d.ts`
  )
    return `modkit-extensions-blizzard/starcraft2/test/mk2/${source}`
  const match = source.match(/^packages\/([^/]+)\/(src|test)\/(.+)$/u)
  if (!match) throw new Error(`No M3 destination: ${source}`)
  const [, packageName, kind, relative] = match
  const root =
    kind === 'src' && !isM3TestOwnedSource(source)
      ? 'modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages'
      : 'modkit-extensions-blizzard/starcraft2/test/mk2/packages'
  return `${root}/${packageName}/${kind}/${relative}`
}

export function assertM3TestDestination(source, destination) {
  if (isM3TestOwnedSource(source) && destination.includes('/src/lib/mk2/'))
    throw new Error(`Test-owned blob placed under src/lib/mk2: ${source}`)
}
