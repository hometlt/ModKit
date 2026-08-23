const NORM_DIV = 1 / 255
const UV_DIV = 1 / 32768
/** Convert a Uint8 VEC3 to normalized float [-1, 1]. */
function vector3AsUint8ToFloat(vec) {
  return [vec.x * NORM_DIV * 2 - 1, vec.y * NORM_DIV * 2 - 1, vec.z * NORM_DIV * 2 - 1]
}
/** Convert M3 UV coords to Three.js UV space. */
function toThreeUv(uv, multiply, offset) {
  const scale = multiply * UV_DIV
  return [uv.x * scale + offset, uv.y * scale + offset]
}
/** Convert a parsed M3 vertex into a plain object ready for Three.js geometry construction. */
export function buildVertexObject(vertex, uvMultiply, uvOffset) {
  const v = vertex
  const pos = v.pos
  const result = { position: [pos.x, pos.y, pos.z] }
  if (v.normalf) {
    const n = v.normalf
    result.normal = [n.x, n.y, n.z]
  } else if (v.normal) {
    result.normal = vector3AsUint8ToFloat(v.normal)
  }
  // Bitangent handedness rides the sign byte next to the packed normal
  // ("Normal. w is the handiness" — model.fx); 255 → +1, 0 → -1.
  const handedness = typeof v.sign === 'number' ? v.sign * NORM_DIV * 2 - 1 : 1
  if (v.tanf) {
    const t = v.tanf
    result.tangent = [t.x, t.y, t.z, handedness]
  } else if (v.tan) {
    const t = vector3AsUint8ToFloat(v.tan)
    result.tangent = [t[0], t[1], t[2], handedness]
  }
  for (let uvIndex = 0; uvIndex < 5; uvIndex += 1) {
    const uvVal = v[`uv${uvIndex}`]
    if (uvVal) result[`uv${uvIndex}`] = toThreeUv(uvVal, uvMultiply, uvOffset)
  }
  for (let uvIndex = 0; uvIndex < 4; uvIndex += 1) {
    const fuvVal = v[`fuv${uvIndex}`]
    if (fuvVal) {
      const fuv = fuvVal
      result[`fuv${uvIndex}`] = [fuv.x, fuv.y]
    }
  }
  if (v.col) {
    const c = v.col
    result.color = [c.r * NORM_DIV, c.g * NORM_DIV, c.b * NORM_DIV, c.a * NORM_DIV]
  }
  const weights = []
  const lookups = []
  for (let i = 0; i < 4; i += 1) {
    const w = v[`weight${i}`]
    const l = v[`lookup${i}`]
    if (w !== undefined) weights.push(w * NORM_DIV)
    if (l !== undefined) lookups.push(l)
  }
  if (weights.length) result.weights = weights
  if (lookups.length) result.boneIndices = lookups
  return result
}
