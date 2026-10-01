/** Logical UVP references only. No filesystem, network, archive or image reads. */
export const isUvpArtifactPath = value => typeof value === 'string' && value.length > 0
  && !/^[A-Za-z]:|^\/|[\\\u0000]/u.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')

/** The URI-addressable subset used by glTF resource closure. */
export function assertUvpArtifactPath(path) {
  if (!isUvpArtifactPath(path) || /[:%?#\u0000-\u001f\u007f]/.test(path))
    throw new TypeError('resource-path: Expected a canonical relative UVP artifact path')
  return path
}

/** glTF image URIs are relative to the document, not the package root. Percent decoding
 * happens once, per segment. Parent segments may never cross the package boundary.
 */
export function resolveUvpResourceUri(documentPath, uri) {
  assertUvpArtifactPath(documentPath)
  if (typeof uri !== 'string' || !uri || /[\\:?#\u0000-\u0020\u007f]/.test(uri))
    throw new TypeError('resource-uri: Expected a relative package resource URI')
  const parts = documentPath.split('/').slice(0, -1)
  const segments = uri.split('/')
  for (const [index, encoded] of segments.entries()) {
    let part
    try { part = decodeURIComponent(encoded) }
    catch { throw new TypeError('resource-uri: Invalid percent encoding') }
    if (!part || /[\\/:%?#\u0000-\u001f\u007f]/.test(part))
      throw new TypeError('resource-uri: Invalid or ambiguous resource segment')
    if (index === segments.length - 1 && (part === '.' || part === '..'))
      throw new TypeError('resource-uri: A resource URI must name an artifact, not a directory')
    if (part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new TypeError('resource-uri: Resource escapes its UVP package')
      parts.pop()
    } else parts.push(part)
  }
  return assertUvpArtifactPath(parts.join('/'))
}
