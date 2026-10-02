/** Semantic admission of optional presentation extensions. No image reads, shader or animation VM. */
type Row = Record<string, unknown>
function fail(message: string): never { throw new TypeError(`model-presentation: ${message}`) }
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object')
  return value as Row
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) fail('Expected an array'); return value as unknown[] }
function closed(value: Row, fields: readonly string[]): void {
  if (Object.keys(value).some(key => !fields.includes(key))) fail('Unknown field')
}
function number(value: unknown, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))
    || value < minimum || value > maximum) fail('Invalid finite number or range')
  return value as number
}
function vector(value: unknown, width: number, minimum = -Infinity, maximum = Infinity): number[] {
  const values = list(value)
  if (values.length !== width) fail('Vector width differs')
  return values.map(value => number(value, minimum, maximum))
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = number(value, 0, maximum)
  if (!Number.isSafeInteger(result)) fail('Expected a nonnegative integer')
  return result
}
function choice(value: unknown, choices: readonly unknown[]): void { if (!choices.includes(value)) fail('Unknown enum value') }
function quaternion(value: unknown): void { if (Math.hypot(...vector(value, 4)) === 0) fail('Quaternion is zero') }
function extensions(document: Row, owner: Row): Row {
  const ext = row(owner['extensions'] ?? {}), used = list(document['extensionsUsed'] ?? [])
  for (const key of Object.keys(ext)) if (!used.includes(key)) fail(`Undeclared ${key}`)
  return ext
}

/** Resource indices/URIs are handled by gltfMaterialTextureInfos and its existing reference owner. */
export function assertUvmTeamColor(raw: unknown, baseColorTexture: unknown): void {
  if (raw === undefined) return
  const value = row(raw)
  closed(value, ['maskSource', 'maskTexture', 'range', 'vertexChannel', 'targets', 'blend', 'strength',
    'defaultColor', 'glow', 'extras', 'keyChannels', 'keyThreshold', 'intensityChannel', 'colorSource',
    'tint', 'secondaryMaskTexture', 'ramp', 'paletteIndexScale'])
  choice(value['maskSource'], ['texture', 'vertexColor', 'paletteRange', 'whole', 'channelKey'])
  choice(value['blend'] ?? 'multiply', ['multiply', 'add', 'replace', 'overlay', 'lerp'])
  choice(value['colorSource'] ?? 'team', ['team', 'object-tint'])
  choice(value['tint'] ?? 'none', ['none', 'mask-rgb'])
  choice(value['vertexChannel'] ?? 'a', ['r', 'g', 'b', 'a'])
  number(value['strength'] ?? 1, 0)
  vector(value['defaultColor'] ?? [1, 1, 1, 1], 4, 0, 1)
  if (value['targets'] !== undefined) for (const target of list(value['targets'])) choice(target, ['baseColor', 'emissive', 'specular'])
  for (const key of ['maskTexture', 'secondaryMaskTexture']) {
    if (value[key] === undefined) continue
    const texture = row(value[key]); closed(texture, ['index', 'texCoord', 'channel', 'extensions'])
    integer(texture['index']); integer(texture['texCoord'] ?? 0)
    choice(texture['channel'] ?? 'a', ['r', 'g', 'b', 'a', 'rgb'])
    const ext = row(texture['extensions'] ?? {}); closed(ext, ['KHR_texture_transform'])
    if (ext['KHR_texture_transform'] !== undefined) {
      const transform = row(ext['KHR_texture_transform']); closed(transform, ['offset', 'rotation', 'scale', 'texCoord'])
      if (transform['offset'] !== undefined) vector(transform['offset'], 2)
      if (transform['scale'] !== undefined) vector(transform['scale'], 2)
      if (transform['rotation'] !== undefined) number(transform['rotation'])
      if (transform['texCoord'] !== undefined) integer(transform['texCoord'])
    }
  }
  if (value['maskSource'] === 'texture' && value['maskTexture'] === undefined) fail('Texture mask is absent')
  if (value['tint'] === 'mask-rgb' && value['maskTexture'] === undefined) fail('mask-rgb requires maskTexture')
  if (value['secondaryMaskTexture'] !== undefined && row(value['secondaryMaskTexture'])['channel'] === 'rgb')
    fail('Secondary coverage requires a scalar channel')
  if (value['maskSource'] === 'channelKey') {
    if (value['blend'] !== 'replace') fail('channelKey requires explicit replace, avoiding intensity squared')
    if (value['maskTexture'] === undefined && baseColorTexture === undefined) fail('channelKey requires a source texture')
    const channels = list(value['keyChannels'] ?? ['r', 'g'])
    if (!channels.length || channels.length > 3 || new Set(channels).size !== channels.length) fail('Invalid key channels')
    for (const channel of channels) choice(channel, ['r', 'g', 'b'])
    integer(value['keyThreshold'] ?? 0, 255); choice(value['intensityChannel'] ?? 'b', ['r', 'g', 'b', 'a'])
  } else if (['keyChannels', 'keyThreshold', 'intensityChannel'].some(key => value[key] !== undefined)) fail('Key fields need channelKey')
  let range: number[] | undefined
  if (value['range'] !== undefined) {
    const values = list(value['range']); if (values.length !== 2) fail('Range needs two indices')
    range = values.map(value => integer(value)); if (range[0]! > range[1]!) fail('Palette range is reversed')
  }
  if (value['maskSource'] === 'paletteRange' && range === undefined) fail('Palette range is absent')
  if (value['ramp'] !== undefined) {
    const ramp = list(value['ramp']), scale = integer(value['paletteIndexScale'] ?? 255, 65535)
    if (scale === 0 || value['maskSource'] !== 'paletteRange' || value['maskTexture'] === undefined
      || value['blend'] !== 'replace' || range === undefined || range[1]! > scale
      || ramp.length !== range[1]! - range[0]! + 1 || ramp.length > 65536) fail('Exact ramp must match indexed palette range')
    if (row(value['maskTexture'])['channel'] === 'rgb') fail('Palette indices require a scalar data channel')
    for (const color of ramp) vector(color, 3, 0, 1)
  } else if (value['paletteIndexScale'] !== undefined) fail('paletteIndexScale needs ramp')
  if (value['glow'] !== undefined) {
    const glow = row(value['glow']); closed(glow, ['maskTexture', 'blend', 'strength'])
    choice(glow['blend'] ?? 'add', ['add', 'multiply', 'replace']); number(glow['strength'] ?? 1, 0)
    // Same textureInfo shape and references as the primary/secondary masks.
    if (glow['maskTexture'] !== undefined) assertUvmTeamColor({ maskSource: 'texture', maskTexture: glow['maskTexture'] }, undefined)
  }
}

export function assertUvmTexturePresentation(raw: unknown): void {
  const ext = row(raw ?? {})
  if (ext['UV_texture_alpha'] !== undefined) {
    const alpha = row(ext['UV_texture_alpha']); closed(alpha, ['ignoreStoredAlpha', 'extras'])
    if (typeof alpha['ignoreStoredAlpha'] !== 'boolean') fail('ignoreStoredAlpha must be explicit boolean')
  }
  if (ext['UV_texture_color_key'] !== undefined) {
    const key = row(ext['UV_texture_color_key']); closed(key, ['color', 'tolerance', 'extras'])
    for (const channel of vector(key['color'], 3, 0, 255)) integer(channel, 255)
    integer(key['tolerance'] ?? 0, 255)
  }
}

/** Bind team-mask property tracks to the existing KHR_animation_pointer/glTF sampler ABI. */
export function assertUvmTeamColorAnimations(rawDocument: unknown): void {
  const document = row(rawDocument), materials = list(document['materials'] ?? []), accessors = list(document['accessors'] ?? [])
  for (const rawAnimation of list(document['animations'] ?? [])) {
    const animation = row(rawAnimation), samplers = list(animation['samplers'] ?? []), targets: string[] = []
    for (const rawChannel of list(animation['channels'] ?? [])) {
      const channel = row(rawChannel), target = row(channel['target']), ext = row(target['extensions'] ?? {})
      if (ext['KHR_animation_pointer'] === undefined) continue
      const pointer = row(ext['KHR_animation_pointer'])['pointer']
      if (typeof pointer !== 'string' || !pointer.includes('/UV_game_material_team_color/')) continue
      if (!list(document['extensionsUsed'] ?? []).includes('KHR_animation_pointer') || target['path'] !== 'pointer'
        || target['node'] !== undefined) fail('Invalid team animation pointer declaration/target')
      const match = /^\/materials\/(0|[1-9][0-9]*)\/extensions\/UV_game_material_team_color\/(strength|glow\/strength|(?:maskTexture|secondaryMaskTexture)\/extensions\/KHR_texture_transform\/(?:rotation|offset|scale)(?:\/[01])?)$/.exec(pointer)
      if (match === null) fail('Unsupported animated team property')
      const material = row(materials[integer(Number(match[1]))]), team = row(row(material['extensions'])['UV_game_material_team_color'])
      let resolved: unknown = team
      for (const part of match[2]!.split('/')) {
        if (!resolved || typeof resolved !== 'object' || !Object.hasOwn(resolved, part)) fail('Animated team property must be authored explicitly')
        resolved = (resolved as Row)[part]
      }
      if (targets.some(previous => previous === pointer || previous.startsWith(pointer + '/') || pointer.startsWith(previous + '/')))
        fail('Duplicate or overlapping team animation targets')
      targets.push(pointer)
      const width = Array.isArray(resolved) ? resolved.length : 1
      if (width === 1) number(resolved); else vector(resolved, 2)
      const sampler = row(samplers[integer(channel['sampler'])]), input = row(accessors[integer(sampler['input'])]),
        output = row(accessors[integer(sampler['output'])]), interpolation = sampler['interpolation'] ?? 'LINEAR'
      choice(interpolation, ['STEP', 'LINEAR', 'CUBICSPLINE'])
      if (input['type'] !== 'SCALAR' || input['componentType'] !== 5126 || output['componentType'] !== 5126
        || output['type'] !== (width === 1 ? 'SCALAR' : 'VEC2') || integer(input['count']) === 0
        || integer(output['count']) !== (interpolation === 'CUBICSPLINE' ? 3 : 1) * (input['count'] as number))
        fail('Team animation accessor width/count differs')
    }
  }
}

const lightProperties = ['color', 'intensity', 'attenuationStart', 'decayExponent', 'innerConeAngle', 'outerConeAngle'] as const
function lightAnimation(light: Row): void {
  if (light['animationDefaults'] === undefined && light['sequenceAnimation'] === undefined) return
  const defaults = row(light['animationDefaults']); closed(defaults, lightProperties)
  vector(defaults['color'], 3, 0); number(defaults['intensity'], 0)
  for (const key of lightProperties.slice(2)) if (defaults[key] !== undefined) number(defaults[key], 0)
  const animation = row(light['sequenceAnimation'] ?? {}); closed(animation, lightProperties)
  sceneTracks(animation, defaults)
}
/** One admission owner for the existing camera/light/effect sequence-track shape. */
function sceneTracks(animation: Row, defaults: Row): void {
  for (const [property, rawEntries] of Object.entries(animation)) {
    if (defaults[property] === undefined) fail('Animated scene property needs a default')
    const fallback = defaults[property], indices = new Set<number>(), width = Array.isArray(fallback) ? fallback.length : 1
    for (const rawEntry of list(rawEntries)) {
      const entry = row(rawEntry); closed(entry, ['sequenceIndex', 'track', 'concurrent', 'wrapSeconds'])
      const index = integer(entry['sequenceIndex']); if (indices.has(index)) fail('Repeated scene sequence index'); indices.add(index)
      if (entry['concurrent'] !== undefined && typeof entry['concurrent'] !== 'boolean') fail('Invalid concurrent flag')
      if (entry['wrapSeconds'] !== undefined && number(entry['wrapSeconds'], 0) === 0) fail('Invalid wrap time')
      const track = row(entry['track']); closed(track, ['lineType', 'globalSeqId', 'keys'])
      if (!Object.hasOwn(track, 'globalSeqId')) fail('Scene track must state nullable globalSeqId')
      choice(track['lineType'], [0, 1, 2, 3]); if (track['globalSeqId'] != null) integer(track['globalSeqId'])
      let previous = -Infinity
      for (const rawKey of list(track['keys'])) {
        const key = row(rawKey); closed(key, ['frame', 'vector', 'inTan', 'outTan'])
        const frame = number(key['frame']); if (frame < previous) fail('Scene keys are unordered'); previous = frame
        vector(key['vector'], width, 0)
        for (const tangent of ['inTan', 'outTan']) if (key[tangent] !== undefined) vector(key[tangent], width)
      }
    }
  }
}

/** Preserve Core's existing three billboard modes and animated native light representation. */
export function assertUvmScenePresentation(rawDocument: unknown): void {
  const document = row(rawDocument), nodes = list(document['nodes'] ?? [])
  for (const rawCamera of list(document['cameras'] ?? [])) {
    const camera = row(rawCamera), raw = extensions(document, camera)['UV_scene_camera']
    if (raw === undefined) continue
    const value = row(raw); closed(value, ['version', 'sequenceAnimation'])
    if (value['version'] !== 1 || camera['type'] !== 'perspective') fail('Invalid scene camera version or lens type')
    const lens = row(camera['perspective']), near = number(lens['znear'], 0), fov = number(lens['yfov'], 0, Math.PI)
    if (near === 0 || fov === 0 || fov === Math.PI) fail('Invalid perspective camera lens')
    if (lens['zfar'] !== undefined && number(lens['zfar'], near) === near) fail('Camera far plane must exceed near')
    const animation = row(value['sequenceAnimation']); closed(animation, ['yfov', 'znear', 'zfar'])
    sceneTracks(animation, lens)
    for (const [property, rawEntries] of Object.entries(animation)) for (const rawEntry of list(rawEntries))
      for (const rawKey of list(row(row(rawEntry)['track'])['keys'])) {
        const component = vector(row(rawKey)['vector'], 1, 0)[0]!
        if (component === 0 || property === 'yfov' && component >= Math.PI) fail('Invalid authored camera lens key')
      }
  }
  for (const rawNode of nodes) {
    const ext = extensions(document, row(rawNode)), raw = ext['UV_node_billboard']
    if (raw === undefined) continue
    const b = row(raw)
    if (b['schemaVersion'] !== 1) fail('Invalid billboard version')
    if (b['mode'] === 'inverse-camera') {
      closed(b, ['schemaVersion', 'mode', 'basisRotations'])
      const rotations = list(b['basisRotations']); if (rotations.length > 4) fail('Too many billboard rotations')
      rotations.forEach(quaternion)
    } else if (b['mode'] === 'face-camera') {
      closed(b, ['schemaVersion', 'mode', 'rotationAxes', 'pivot']); choice(b['rotationAxes'], ['z', 'xz']); vector(b['pivot'], 3)
    } else if (b['mode'] === 'aim') {
      closed(b, ['schemaVersion', 'mode', 'aim', 'lock', 'correction', 'rootCorrection'])
      choice(b['aim'], ['view', 'eye']); choice(b['lock'], ['free', 'frame-x', 'frame-y', 'frame-z', 'own-x', 'own-y'])
      for (const key of ['correction', 'rootCorrection']) if (b[key] !== undefined) quaternion(b[key])
    } else fail('Invalid billboard mode')
  }
  const raw = extensions(document, document)['UV_scene_lights']; if (raw === undefined) return
  const scene = row(raw); closed(scene, ['version', 'spaceNode', 'lights', 'ambient'])
  if (scene['version'] !== 1 || integer(scene['spaceNode']) >= nodes.length) fail('Invalid scene light frame')
  vector(scene['ambient'] ?? [0, 0, 0], 3, 0, 1)
  for (const rawLight of list(scene['lights'])) {
    const light = row(rawLight); closed(light, ['type', 'direction', 'color', 'position', 'range', 'attenuationStart',
      'attenuationEnd', 'decayExponent', 'innerConeAngle', 'outerConeAngle', 'sequenceAnimation', 'animationDefaults'])
    choice(light['type'], ['directional', 'point', 'spot']); vector(light['color'], 3, 0)
    if (Math.hypot(...vector(light['direction'], 3)) <= 1e-8) fail('Light direction is zero')
    if (light['type'] !== 'directional' || light['position'] !== undefined) vector(light['position'], 3)
    for (const key of ['range', 'attenuationStart', 'attenuationEnd', 'decayExponent', 'innerConeAngle', 'outerConeAngle'])
      if (light[key] !== undefined) number(light[key], 0)
    lightAnimation(light)
  }
}

/** Optional game-view preset; all distances remain in the authored space basis. */
export function assertUvwCamera(raw: unknown): void {
  if (raw === undefined) return
  const camera = row(raw); closed(camera, ['projection', 'azimuthDegrees', 'elevationDegrees', 'fieldOfViewDegrees', 'drawDistance'])
  choice(camera['projection'], ['orthographic', 'perspective'])
  if (camera['azimuthDegrees'] !== undefined) number(camera['azimuthDegrees'])
  if (camera['elevationDegrees'] !== undefined) number(camera['elevationDegrees'], 0, 90)
  if (camera['fieldOfViewDegrees'] !== undefined) {
    const fov = number(camera['fieldOfViewDegrees'], 0, 180)
    if (camera['projection'] !== 'perspective' || fov === 0 || fov === 180) fail('Invalid game-view perspective field of view')
  }
  if (camera['drawDistance'] !== undefined && number(camera['drawDistance'], 0) === 0) fail('Invalid game-view draw distance')
}

/** Optional UVW metadata; validated once by the shared spatial profile for legacy and glTF envelopes. */
export function assertUvwObjectPresentation(raw: unknown): void {
  const object = row(raw)
  if (object['presentationTint'] !== undefined) vector(object['presentationTint'], 3, 0, 1)
  if (object['presentationAnimation'] !== undefined) {
    const animation = row(object['presentationAnimation']); closed(animation, ['name', 'groups', 'loop', 'speed', 'randomStart'])
    for (const value of [animation['name'], ...list(animation['groups'])])
      if (typeof value !== 'string' || !value.trim()) fail('Initial clip needs nonempty name/groups')
    if (typeof animation['loop'] !== 'boolean' || (animation['randomStart'] !== undefined && typeof animation['randomStart'] !== 'boolean')) fail('Invalid clip flags')
    number(animation['speed'])
  }
}
