import { textCodec } from '../warzone-img/codec.js'

const OPENERS = new Set([
  'level',
  'campaign',
  'camstart',
  'camchange',
  'expand',
  'between',
  'miss_keep',
  'miss_clear',
  'expand_limbo',
  'miss_keep_limbo',
])
const parse = source => {
  const entries = []
  let current
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = raw.replace(/\/\/.*$/u, '').trim()
    if (line === '') continue
    const match = /^(\w+)\s+(?:"([^"]*)"|(\S+))/u.exec(line)
    if (match === null) throw new TypeError(`invalid Warzone LEV instruction on line ${index + 1}`)
    const keyword = match[1].toLowerCase()
    const value = match[2] ?? match[3]
    if (OPENERS.has(keyword)) {
      current = {
        line: index + 1,
        keyword,
        name: value,
        players: 1,
        type: keyword === 'level' ? 0 : 1,
        dataset: '',
        files: [],
      }
      entries.push(current)
      continue
    }
    if (current === undefined) throw new TypeError('Warzone LEV instruction precedes an entry')
    if (keyword === 'players' || keyword === 'type') current[keyword] = Number(value)
    else if (keyword === 'dataset') current.dataset = value
    else if (keyword === 'data' || keyword === 'game') current.files.push(value)
    else throw new TypeError(`unknown Warzone LEV keyword ${keyword}`)
  }
  if (entries.length === 0) throw new TypeError('Warzone LEV contains no entries')
  return entries
}
const codec = textCodec({
  id: 'org.modkitx/warzone-lev',
  formatId: 'warzone-lev',
  label: 'Warzone 2100 level index',
  confidence: 0.96,
  matches: source => /(?:^|\n)\s*(?:level|campaign|camstart|camchange)\s+[\w"]/iu.test(source),
  parse,
  table: {
    header: ['line', 'kind', 'name', 'type', 'players', 'dataset', 'files'],
    rows: value =>
      value.map(item => [
        item.line,
        item.keyword,
        item.name,
        item.type,
        item.players,
        item.dataset,
        item.files.join(', '),
      ]),
    summary: value => ({ levels: value.length }),
    metadata: value => [{ key: 'levels', value: value.length }],
    children: value =>
      value.map(item => ({
        kind: item.keyword,
        label: item.name,
        preview: `${item.files.length} files`,
      })),
  },
  unsupported: ['cross-file-dataset-resolution', 'json-level-index', 'level-index-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
