export function textParameters(info) {
  return Object.freeze({
    encoding: info.encoding,
    lineCount: info.lines,
    bom: info.bom,
    newline: info.newline,
  })
}
