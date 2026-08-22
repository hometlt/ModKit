// AoM PRT layout follows the published AoM Engine Library parser and 010 template:
// https://github.com/Ryder25/Age-of-Mythology/blob/master/src/AoMEngineLibrary/Graphics/Prt/PrtFile.cs

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/prt'
const APPEARANCE_TYPES = Object.freeze(['billboard', 'axial-billboard', 'up-facing', 'geometry'])
const SHAPE_TYPES = Object.freeze([
  'point',
  'box-solid',
  'box-surface',
  'box-hollow',
  'ellipsoid-solid',
  'ellipsoid-surface',
  'ellipsoid-hollow',
  'half-ellipsoid-solid',
  'half-ellipsoid-surface',
  'half-ellipsoid-hollow',
  'rectangle',
  'circle',
])
const MATERIAL_TYPES = Object.freeze(['normal', 'additive', 'subtractive'])
const TERRAIN_TYPES = Object.freeze(['fixed', 'minimum', 'maximum'])

class Cursor {
  constructor(bytes) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.offset = 0
  }

  ensure(length, label) {
    if (
      length < 0 ||
      this.offset > this.bytes.byteLength ||
      length > this.bytes.byteLength - this.offset
    )
      throw new RangeError(`PRT ${label} is outside the file`)
  }

  skip(length, label) {
    this.ensure(length, label)
    this.offset += length
  }

  u8(label) {
    this.ensure(1, label)
    return this.bytes[this.offset++]
  }

  bool(label) {
    const value = this.u8(label)
    if (value > 1) throw new TypeError(`PRT ${label} boolean is invalid`)
    return value === 1
  }

  i32(label) {
    this.ensure(4, label)
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  f32(label) {
    this.ensure(4, label)
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    if (!Number.isFinite(value)) throw new TypeError(`PRT ${label} is not finite`)
    return value
  }

  rgba(label) {
    return [
      this.u8(`${label}.r`),
      this.u8(`${label}.g`),
      this.u8(`${label}.b`),
      this.u8(`${label}.a`),
    ]
  }

  string(label) {
    const length = this.i32(`${label} length`)
    if (length < 0) throw new RangeError(`PRT ${label} length is negative`)
    if (length > Math.floor((this.bytes.byteLength - this.offset) / 2))
      throw new RangeError(`PRT ${label} is outside the file`)
    const byteLength = length * 2
    this.ensure(byteLength, label)
    let value
    try {
      value = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(
        this.bytes.subarray(this.offset, this.offset + byteLength),
      )
    } catch (error) {
      throw new TypeError(`PRT ${label} is not valid UTF-16LE: ${String(error)}`)
    }
    this.offset += byteLength
    if (value.includes('\0')) throw new TypeError(`PRT ${label} contains a NUL character`)
    return value
  }
}

function enumValue(value, names, label) {
  if (value === -1) return 'invalid'
  if (value < 0 || value >= names.length) throw new TypeError(`PRT ${label} ${value} is invalid`)
  return names[value]
}

function parsePrt(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('PRT structure exceeds maxDepth budget')
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('PRT metadata exceeds maxScalarBytes budget')
  let nodes = 9
  if (nodes > budget.maxNodes) throw new RangeError('PRT sections exceed maxNodes budget')
  const claimNodes = (count, label) => {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError(`PRT ${label} count is invalid`)
    nodes += count
    if (nodes > budget.maxNodes) throw new RangeError(`PRT ${label} exceed maxNodes budget`)
    return count
  }
  const cursor = new Cursor(bytes)
  const version = cursor.i32('version')
  if (version !== 11 && version !== 12) throw new TypeError(`PRT version ${version} is unsupported`)

  const emitterFlags = {
    tiedToEmitter: cursor.bool('emitter.tiedToEmitter'),
    ignoreRotation: cursor.bool('emitter.ignoreRotation'),
    emitByMotion: cursor.bool('emitter.emitByMotion'),
    loop: cursor.bool('emitter.loop'),
    inheritVelocity: cursor.bool('emitter.inheritVelocity'),
    useMinVelocity: cursor.bool('emitter.useMinVelocity'),
    useMaxVelocity: cursor.bool('emitter.useMaxVelocity'),
    alwaysActive: cursor.bool('emitter.alwaysActive'),
  }
  if (version >= 12) {
    emitterFlags.syncWithAttackAnimation = cursor.bool('emitter.syncWithAttackAnimation')
    cursor.skip(3, 'emitter padding')
  }
  const maxParticles = cursor.i32('emitter.maxParticles')
  if (maxParticles < 0) throw new RangeError('PRT maxParticles is negative')
  const appearanceType = enumValue(
    cursor.i32('emitter.appearanceType'),
    APPEARANCE_TYPES,
    'appearance type',
  )
  const emitterValues = Array.from({ length: 32 }, (_, index) =>
    cursor.f32(`emitter value ${index}`),
  )

  const shapeFlags = {
    startFull: cursor.bool('shape.startFull'),
    emitAwayFromBias: cursor.bool('shape.emitAwayFromBias'),
    useSpreader: cursor.bool('shape.useSpreader'),
  }
  cursor.skip(1, 'shape padding')
  const shapeType = enumValue(cursor.i32('shape.type'), SHAPE_TYPES, 'shape type')
  const shapeValues = Array.from({ length: 12 }, (_, index) => cursor.f32(`shape value ${index}`))

  const orientByMotion = cursor.bool('appearance.orientByMotion')
  cursor.skip(3, 'appearance padding')
  const appearanceFileCount = claimNodes(cursor.i32('appearance.numFiles'), 'appearance files')
  const frameCount = cursor.i32('appearance.numFrames')
  const frameWidth = cursor.i32('appearance.frameWidth')
  const frameHeight = cursor.i32('appearance.frameHeight')
  if (frameCount < 0 || frameWidth < 0 || frameHeight < 0)
    throw new RangeError('PRT appearance frame values are negative')
  const materialType = enumValue(
    cursor.i32('appearance.materialType'),
    MATERIAL_TYPES,
    'material type',
  )
  const emissive = cursor.rgba('appearance.emissive')
  const specular = cursor.rgba('appearance.specular')
  const appearanceValues = Array.from({ length: 4 }, (_, index) =>
    cursor.f32(`appearance value ${index}`),
  )

  const opacityLoop = cursor.bool('opacity.loopingCycle')
  cursor.skip(3, 'opacity padding')
  const opacityStageCount = claimNodes(cursor.i32('opacity.numStages'), 'opacity stages')
  const opacityValues = Array.from({ length: 4 }, (_, index) =>
    cursor.f32(`opacity value ${index}`),
  )

  const scaleLoop = cursor.bool('scale.loopingCycle')
  cursor.skip(3, 'scale padding')
  const scaleStageCount = claimNodes(cursor.i32('scale.numStages'), 'scale stages')
  const scaleValues = Array.from({ length: 10 }, (_, index) => cursor.f32(`scale value ${index}`))

  const usePalette = cursor.bool('color.usePalette')
  const colorLoop = cursor.bool('color.loopingCycle')
  cursor.skip(2, 'color padding')
  const paletteColorCount = claimNodes(cursor.i32('color.numPaletteColors'), 'palette colors')
  const colorStageCount = claimNodes(cursor.i32('color.numStages'), 'color stages')
  const colorValues = Array.from({ length: 3 }, (_, index) => cursor.f32(`color value ${index}`))
  const color = cursor.rgba('color.base')

  const forceFlags = {
    randomOrientation: cursor.bool('forces.randomOrientation'),
    tumble: cursor.bool('forces.tumble'),
    tumbleBothDirections: cursor.bool('forces.tumbleBothDirections'),
    randomAxis: cursor.bool('forces.randomAxis'),
  }
  const forceValues = Array.from({ length: 20 }, (_, index) => cursor.f32(`force value ${index}`))

  const collisionTypeCount = claimNodes(cursor.i32('collision.numTypes'), 'collision types')
  const terrainInteraction = enumValue(
    cursor.i32('collision.terrainInteractionType'),
    TERRAIN_TYPES,
    'terrain interaction type',
  )
  const terrainHeight = cursor.f32('collision.terrainHeight')
  const terrainHeightVariation = cursor.f32('collision.terrainHeightVariation')
  const brgFileName = cursor.string('BRG filename')

  const paletteColors = Array.from({ length: paletteColorCount }, (_, index) =>
    cursor.rgba(`palette color ${index}`),
  )
  const appearanceWeights = Array.from({ length: appearanceFileCount }, (_, index) =>
    cursor.f32(`appearance weight ${index}`),
  )
  const appearanceFiles = Array.from({ length: appearanceFileCount }, (_, index) =>
    cursor.string(`appearance file ${index}`),
  )
  const opacityStages = Array.from({ length: opacityStageCount }, (_, index) =>
    Array.from({ length: 4 }, (_, valueIndex) =>
      cursor.f32(`opacity stage ${index}.${valueIndex}`),
    ),
  )
  const scaleStages = Array.from({ length: scaleStageCount }, (_, index) =>
    Array.from({ length: 4 }, (_, valueIndex) => cursor.f32(`scale stage ${index}.${valueIndex}`)),
  )
  const colorStages = Array.from({ length: colorStageCount }, (_, index) => {
    const stageUsesPalette = cursor.bool(`color stage ${index}.usePalette`)
    cursor.skip(3, `color stage ${index} padding`)
    return {
      usePalette: stageUsesPalette,
      color: cursor.rgba(`color stage ${index}.color`),
      hold: cursor.f32(`color stage ${index}.hold`),
      fade: cursor.f32(`color stage ${index}.fade`),
    }
  })
  const collisions = Array.from({ length: collisionTypeCount }, (_, index) => {
    const flags = {
      spawnSystem: cursor.bool(`collision ${index}.spawnSystem`),
      collideTerrain: cursor.bool(`collision ${index}.collideTerrain`),
      collideWater: cursor.bool(`collision ${index}.collideWater`),
      collideUnits: cursor.bool(`collision ${index}.collideUnits`),
    }
    const result = cursor.i32(`collision ${index}.result`)
    const fileCount = claimNodes(cursor.i32(`collision ${index}.numFileNames`), 'collision files')
    const values = Array.from({ length: 6 }, (_, valueIndex) =>
      cursor.f32(`collision ${index} value ${valueIndex}`),
    )
    const name = cursor.string(`collision ${index} name`)
    const files = Array.from({ length: fileCount }, (_, fileIndex) =>
      cursor.string(`collision ${index} file ${fileIndex}`),
    )
    return { flags, result, values, name, files }
  })
  if (cursor.offset !== bytes.byteLength)
    throw new TypeError(`PRT has ${bytes.byteLength - cursor.offset} trailing byte(s)`)

  return Object.freeze({
    version,
    emitter: Object.freeze({
      flags: Object.freeze(emitterFlags),
      maxParticles,
      appearanceType,
      updateRadius: emitterValues[0],
      particleLife: emitterValues[2],
      emissionRate: emitterValues[10],
    }),
    shape: Object.freeze({
      flags: Object.freeze(shapeFlags),
      type: shapeType,
      outerRadius: Object.freeze([shapeValues[0], shapeValues[2], shapeValues[4]]),
    }),
    appearance: Object.freeze({
      orientByMotion,
      frameCount,
      frameWidth,
      frameHeight,
      materialType,
      emissive: Object.freeze(emissive),
      specular: Object.freeze(specular),
      specularExponent: appearanceValues[0],
      framesPerSecond: appearanceValues[1],
      files: Object.freeze(appearanceFiles),
      weights: Object.freeze(appearanceWeights),
    }),
    opacity: Object.freeze({ looping: opacityLoop, values: opacityValues, stages: opacityStages }),
    scale: Object.freeze({ looping: scaleLoop, values: scaleValues, stages: scaleStages }),
    color: Object.freeze({
      usePalette,
      looping: colorLoop,
      values: colorValues,
      color: Object.freeze(color),
      palette: paletteColors,
      stages: colorStages,
    }),
    forces: Object.freeze({ flags: forceFlags, values: forceValues }),
    collision: Object.freeze({
      terrainInteraction,
      terrainHeight,
      terrainHeightVariation,
      types: collisions,
    }),
    brgFileName,
    nodes,
  })
}

function looksLikePrt(prefix) {
  if (prefix.byteLength < 456) return false
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
  const version = view.getInt32(0, true)
  if (version !== 11 && version !== 12) return false
  for (let offset = 4; offset < 12; offset += 1) if (prefix[offset] > 1) return false
  return true
}

function referenceNodes(label, values) {
  return values.map((value, index) => ({
    kind: 'reference',
    label: `${label} ${index}`,
    preview: value,
  }))
}

export const abiVersion = 1
export const createCodec = context =>
  createInspectionCodec(
    Object.freeze({
      id: ID,
      version: '1.0.0',
      format: Object.freeze({ id: 'prt', label: 'AoM PRT particle system' }),
      async detect(prefix) {
        return looksLikePrt(prefix)
          ? { confidence: 0.78, kind: 'structure', note: 'PRT v11/v12 section framing' }
          : { confidence: 0, kind: 'structure', note: 'PRT v11/v12 framing missing' }
      },
      async inspect(bytes, inspectionContext) {
        const particle = parsePrt(bytes, inspectionContext.budget)
        const collisionReferences = particle.collision.types.flatMap(type => type.files)
        const referenceCount =
          particle.appearance.files.length +
          collisionReferences.length +
          (particle.brgFileName ? 1 : 0)
        const summary = {
          format: 'prt',
          version: particle.version,
          maxParticles: particle.emitter.maxParticles,
          appearanceType: particle.emitter.appearanceType,
          shapeType: particle.shape.type,
          materialType: particle.appearance.materialType,
          frames: particle.appearance.frameCount,
          frameWidth: particle.appearance.frameWidth,
          frameHeight: particle.appearance.frameHeight,
          appearanceFiles: particle.appearance.files.length,
          opacityStages: particle.opacity.stages.length,
          scaleStages: particle.scale.stages.length,
          colorStages: particle.color.stages.length,
          collisionTypes: particle.collision.types.length,
          referenceCount,
          brgFileName: particle.brgFileName,
        }
        return {
          summary,
          metadata: [
            {
              id: 'prt-particle-system',
              label: 'AoM particle system',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'content.metadata', parameters: { kind: 'particle-system' } },
            { id: 'image.frames', parameters: { count: particle.appearance.frameCount } },
            { id: 'structure.hierarchy', parameters: { nodes: particle.nodes } },
            { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'particle-system',
              label: `PRT v${particle.version}`,
              preview: `${particle.emitter.maxParticles} particles, ${referenceCount} reference(s)`,
              children: [
                {
                  kind: 'section',
                  label: 'Emitter',
                  preview: `${particle.emitter.appearanceType}, rate ${particle.emitter.emissionRate}`,
                },
                { kind: 'section', label: 'Shape', preview: particle.shape.type },
                {
                  kind: 'section',
                  label: 'Appearance',
                  preview: `${particle.appearance.frameCount} frame(s), ${particle.appearance.frameWidth} × ${particle.appearance.frameHeight}`,
                  children: [
                    ...(particle.brgFileName
                      ? [
                          {
                            kind: 'reference',
                            label: 'BRG geometry',
                            preview: particle.brgFileName,
                          },
                        ]
                      : []),
                    ...referenceNodes('Texture', particle.appearance.files),
                  ],
                },
                {
                  kind: 'section',
                  label: 'Opacity stages',
                  preview: String(particle.opacity.stages.length),
                },
                {
                  kind: 'section',
                  label: 'Scale stages',
                  preview: String(particle.scale.stages.length),
                },
                {
                  kind: 'section',
                  label: 'Color stages',
                  preview: `${particle.color.stages.length} stage(s), ${particle.color.palette.length} palette color(s)`,
                },
                { kind: 'section', label: 'Forces' },
                {
                  kind: 'section',
                  label: 'Collisions',
                  preview: `${particle.collision.types.length} type(s)`,
                  children: particle.collision.types.map((type, index) => ({
                    kind: 'collision',
                    label: type.name || `Collision ${index}`,
                    children: referenceNodes('Particle system', type.files),
                  })),
                },
              ],
            }),
          },
          maxDecodedBytes: BigInt(bytes.byteLength),
          unsupportedFeatures: [
            'referenced-asset-resolution',
            'particle-simulation',
            'prt-writing',
          ],
        }
      },
    }),
    context,
  )
