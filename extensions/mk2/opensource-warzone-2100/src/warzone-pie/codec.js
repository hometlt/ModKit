import { textCodec } from '../warzone-img/codec.js'

const parse = source => {
  const lines = source
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
  const header = /^PIE\s+(\d+)$/u.exec(lines[0] ?? '')
  if (header === null) throw new TypeError('Warzone PIE header is missing')
  const directives = lines.slice(1).map((line, index) => {
    const space = line.indexOf(' ')
    return {
      line: index + 2,
      keyword: space < 0 ? line : line.slice(0, space),
      value: space < 0 ? '' : line.slice(space + 1),
    }
  })
  return { version: Number(header[1]), directives }
}
const codec = textCodec({
  id: 'org.modkitx/warzone-pie',
  formatId: 'warzone-pie',
  label: 'Warzone 2100 PIE model',
  confidence: 0.99,
  matches: source => /^PIE\s+\d+/u.test(source.trimStart()),
  parse,
  table: {
    header: ['line', 'directive', 'value'],
    rows: value => value.directives.map(item => [item.line, item.keyword, item.value]),
    summary: value => ({ version: value.version, directives: value.directives.length }),
    metadata: value => [
      { key: 'version', value: value.version },
      { key: 'directives', value: value.directives.length },
    ],
    children: value =>
      value.directives.map(item => ({
        kind: 'directive',
        label: item.keyword,
        preview: item.value,
      })),
  },
  unsupported: ['geometry-preview', 'event-resolution', 'texture-reading', 'pie-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
