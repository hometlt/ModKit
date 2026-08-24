// Container, hierarchy and reference planes of a SAGE W3X `AssetDeclaration`.
//
// W3X is unusually explicit for a game format, and this module leans on that rather than on
// convention. A container names its skeleton by id (`Hierarchy="GUPREDTANK_SKL"`); a sub-object
// names its bone by index and its render object by id; and — the part worth having — it says in the
// element itself whether that object is a `<Mesh>` or a `<CollisionBox>`. So render and collision
// are read here, never inferred from a name, a suffix or a bounding volume's shape.
//
// The one thing this module refuses to do is follow a path. A reference is an *id*, and the codec
// turns an id into a companion pattern the host resolves inside the scopes it was granted. A
// document that tries to name a location — `../other/thing`, `C:\...`, a URL — is rejected, because
// a model file is not allowed to widen its own search.

/** Ids that cannot become a companion pattern: they name a place rather than an asset. */
const PATH_LIKE = /[\\/]|^\.\.?$|^[A-Za-z]:|^[a-z][a-z0-9+.-]*:/u

function blocks(source, name) {
  const pattern = new RegExp(`<${name}\\b([^<>]*?)(?:/\\s*>|>([\\s\\S]*?)</${name}\\s*>)`, 'gu')
  return [...source.matchAll(pattern)].map(match => ({ element: match[0], body: match[2] }))
}

function attribute(element, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'u').exec(element)
  return match?.[1] ?? match?.[2]
}

function textOf(body, name) {
  const match = new RegExp(`<${name}(?:\\s[^<>]*?)?>([^<]*)</${name}\\s*>`, 'u').exec(body ?? '')
  return match?.[1]?.trim()
}

/**
 * Is this reference an asset id this codec may turn into a companion pattern?
 *
 * `GUPREDTANK_SKL` is; `../../shared/skl` and `file:///x` are not. The rule is deliberately a
 * whitelist of shape rather than a blacklist of prefixes: anything carrying a separator, a drive
 * letter, a scheme or a dot-segment is refused outright, so a crafted document cannot reach past
 * the scopes the host granted by dressing a path up as an id.
 */
export function isAssetId(value) {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 128 && !PATH_LIKE.test(value)
  )
}

/**
 * `W3DContainer` → the model-part table.
 *
 * Every relation here is an explicit attribute or element: the skeleton by `Hierarchy`, the bone by
 * `BoneIndex`, the part by the id inside `<Mesh>` or `<CollisionBox>`. Nothing is matched by name
 * similarity, and a sub-object whose render object this reader does not recognise is reported with
 * its element name rather than assumed to be geometry.
 */
export function parseContainers(source, issues) {
  return Object.freeze(
    blocks(source, 'W3DContainer').map(container => {
      const id = attribute(container.element, 'id') ?? ''
      const hierarchyRef = attribute(container.element, 'Hierarchy')
      if (hierarchyRef !== undefined && !isAssetId(hierarchyRef)) {
        issues.push({
          code: 'sage-w3x-hierarchy-reference-refused',
          message: `W3X container «${id}» names its hierarchy with «${hierarchyRef}», which is a path rather than an asset id`,
        })
      }
      const subObjects = blocks(container.body ?? '', 'SubObject').map(sub => {
        const subId = attribute(sub.element, 'SubObjectID') ?? ''
        const boneRaw = attribute(sub.element, 'BoneIndex')
        const boneIndex = boneRaw === undefined ? -1 : Number.parseInt(boneRaw, 10)
        const mesh = textOf(sub.body, 'Mesh')
        const collisionBox = textOf(sub.body, 'CollisionBox')
        return Object.freeze({
          id: subId,
          boneIndex: Number.isSafeInteger(boneIndex) ? boneIndex : -1,
          // the document states the role; this reader does not derive one
          ...(mesh !== undefined
            ? { role: 'render', renderObject: mesh }
            : collisionBox !== undefined
              ? { role: 'collision', renderObject: collisionBox }
              : { role: 'unknown' }),
        })
      })
      return Object.freeze({
        id,
        ...(hierarchyRef !== undefined && isAssetId(hierarchyRef) ? { hierarchyRef } : {}),
        subObjects: Object.freeze(subObjects),
      })
    }),
  )
}

/** `W3DHierarchy` → named pivots whose parent is the `Parent` attribute, never their position. */
export function parseHierarchies(source) {
  return Object.freeze(
    blocks(source, 'W3DHierarchy').map(hierarchy => {
      const pivots = blocks(hierarchy.body ?? '', 'Pivot').map((pivot, index) => {
        const parentRaw = attribute(pivot.element, 'Parent')
        const parent = parentRaw === undefined ? -1 : Number.parseInt(parentRaw, 10)
        return Object.freeze({
          index,
          name: attribute(pivot.element, 'Name') ?? `Pivot_${index}`,
          parentIndex: Number.isSafeInteger(parent) ? parent : -1,
        })
      })
      return Object.freeze({
        id: attribute(hierarchy.element, 'id') ?? '',
        pivots: Object.freeze(pivots),
      })
    }),
  )
}

/** `W3DAnimation` blocks, counted only where the document actually declares one. */
export function parseAnimations(source) {
  return Object.freeze(
    blocks(source, 'W3DAnimation').map((animation, index) => {
      const channels = blocks(animation.body ?? '', 'Channel').length
      return Object.freeze({
        id: attribute(animation.element, 'id') ?? `W3DAnimation_${index}`,
        ...(attribute(animation.element, 'Hierarchy') === undefined
          ? {}
          : { hierarchyRef: attribute(animation.element, 'Hierarchy') }),
        channels,
      })
    }),
  )
}

/**
 * Texture references, as the shader states them.
 *
 * A `<Texture Name="DiffuseTexture"><Value>GUPredatorTank</Value></Texture>` names an asset, not a
 * file: the extension is the engine's convention, not the document's. So the value is published as
 * the reference it is, and the codec — not this module — decides what a companion pattern for it
 * looks like.
 */
export function parseTextureReferences(source, issues) {
  const found = []
  const seen = new Set()
  for (const shader of blocks(source, 'FXShader')) {
    const shaderName = attribute(shader.element, 'ShaderName') ?? ''
    for (const texture of blocks(shader.body ?? '', 'Texture')) {
      const slot = attribute(texture.element, 'Name') ?? ''
      const value = textOf(texture.body, 'Value')
      if (value === undefined || value === '') continue
      if (!isAssetId(value)) {
        issues.push({
          code: 'sage-w3x-texture-reference-refused',
          message: `W3X shader «${shaderName}» names texture slot «${slot}» with «${value}», which is a path rather than an asset id`,
        })
        continue
      }
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      found.push(Object.freeze({ slot, value, shaderName }))
    }
  }
  return Object.freeze(found)
}

/** Element names the reader met but does not decode, so a document never loses them silently. */
export function unknownElements(source, known) {
  const counts = new Map()
  for (const match of source.matchAll(/<([A-Za-z][A-Za-z0-9_]*)\b/gu)) {
    const name = match[1]
    if (known.has(name)) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([name, count]) => Object.freeze({ name, count })),
  )
}
