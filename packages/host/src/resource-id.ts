/**
 * The parameters a logical resource id names after its last `#`, and the resource name before
 * them: `data/DATA.R16#frame=3` is frame 3 of `data/DATA.R16`, `unit/htnk.vxl#palette=unittem.pal&
 * turretOffset=0` two parameters joined by `&`. Values are percent-decoded.
 *
 * A fragment that is not such a list — a part without `=`, an empty or repeated key, a malformed
 * escape — is part of the name instead, as file names may hold `#`. What a parameter means is the
 * reader's: the host reads `region` and `frame` of a raster, a model codec its own.
 */
export function resourceIdParameters(
  logicalId: string,
): Readonly<{ name: string; parameters: Readonly<Record<string, string>> }> {
  const none = Object.freeze({ name: logicalId, parameters: Object.freeze({}) })
  const hash = logicalId.lastIndexOf('#')
  if (hash < 0) return none
  const parameters: Record<string, string> = {}
  for (const part of logicalId.slice(hash + 1).split('&')) {
    const equals = part.indexOf('=')
    const key = part.slice(0, Math.max(equals, 0))
    if (equals <= 0 || !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(key) || Object.hasOwn(parameters, key))
      return none
    try {
      parameters[key] = decodeURIComponent(part.slice(equals + 1))
    } catch {
      return none
    }
  }
  return Object.freeze({ name: logicalId.slice(0, hash), parameters: Object.freeze(parameters) })
}
