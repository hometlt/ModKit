// SPDX-License-Identifier: GPL-2.0-or-later
import { textCodec } from '../warzone-img/codec.js'

const parse = source => {
  const records = []
  let directory = ''
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = raw.replace(/\/\/.*$/u, '').trim()
    if (line === '') continue
    const directoryMatch = /^directory\s+"([^"]*)"/iu.exec(line)
    if (directoryMatch !== null) {
      directory = directoryMatch[1].replaceAll('\\', '/').replace(/\/+$/u, '')
      continue
    }
    const fileMatch = /^file\s+([A-Za-z_][\w]*)\s+"([^"]+)"/iu.exec(line)
    if (fileMatch === null)
      throw new TypeError(`invalid Warzone WRF instruction on line ${index + 1}`)
    const name = fileMatch[2].replaceAll('\\', '/')
    records.push({
      line: index + 1,
      type: fileMatch[1],
      name,
      path: directory === '' ? name : `${directory}/${name}`,
    })
  }
  if (records.length === 0) throw new TypeError('Warzone WRF contains no file instruction')
  return records
}
const codec = textCodec({
  id: 'org.modkitx/warzone-wrf',
  formatId: 'warzone-wrf',
  label: 'Warzone 2100 resource list',
  confidence: 0.96,
  matches: source => /(?:^|\n)\s*(?:directory|file)\s+/iu.test(source),
  parse,
  table: {
    header: ['line', 'type', 'name', 'resolvedPath'],
    rows: value => value.map(item => [item.line, item.type, item.name, item.path]),
    summary: value => ({ resources: value.length }),
    metadata: value => [{ key: 'resources', value: value.length }],
    children: value =>
      value.map(item => ({ kind: 'resource', label: item.name, preview: item.type })),
  },
  unsupported: ['reference-following', 'resource-loading', 'resource-list-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
