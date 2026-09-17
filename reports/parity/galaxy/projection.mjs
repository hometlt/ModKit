// Declared Galaxy comparison projection, applied identically to both arms.
// Values are finite JSON: undefined members are absent and class instances become plain data.
const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)))
const severity = value => (value === 'info' ? 'information' : value)
const checkerSeverity = category =>
  category === 2 ? 'warning' : category === 3 ? 'information' : category === 4 ? 'hint' : 'error'
const LANGUAGE = 'blizzard.galaxy/language'
const TYPE_CHECK = 'blizzard.galaxy/type-check'

const languageDiagnostic = item => ({ message: item.message, start: item.start, end: item.end, severity: severity(item.severity) })
const nativeDiagnostic = item => ({ message: item.message, start: item.data.start, end: item.data.end, severity: item.severity })
const withoutAst = index => plain({ ...index, sourceFile: undefined })

function applyRename(text, proposal) {
  let output = text
  for (const reference of [...proposal.references].sort((a, b) => b.start - a.start))
    output = `${output.slice(0, reference.start)}${proposal.newName}${output.slice(reference.end)}`
  return output
}

/**
 * `legacy` arguments carry MK2 shapes; `native` arguments carry MK3 published-operation shapes.
 * Every other argument is already shared data.
 */
export function project(probe, { legacy, native, value, text }) {
  switch (probe) {
    case 'view.inspect':
      return legacy !== undefined
        ? { symbols: legacy.symbols.length, languageDiagnostics: legacy.diagnostics.length }
        : { symbols: native.summary.symbols, languageDiagnostics: native.validate.filter(item => item.code === LANGUAGE).length }
    case 'script.symbols':
      return plain(legacy ?? native)
    case 'asset.validate':
      return legacy !== undefined
        ? legacy.map(languageDiagnostic)
        : native.filter(item => item.code === LANGUAGE).map(nativeDiagnostic)
    case 'type-check':
      return legacy !== undefined
        ? legacy.map(item => ({
            message: String(item.messageText),
            start: item.start ?? 0,
            end: (item.start ?? 0) + (item.length ?? 1),
            severity: checkerSeverity(item.category),
            line: item.line ?? null,
            column: item.col ?? null,
          }))
        : native.filter(item => item.code === TYPE_CHECK).map(item => ({
            ...nativeDiagnostic(item),
            line: item.data.line ?? null,
            column: item.data.column ?? null,
          }))
    case 'edit.structure':
      if (legacy !== undefined) {
        if (legacy.declaration === undefined) throw new Error('Galaxy rename offset is not an identifier')
        return { previousName: text.slice(legacy.declaration.start, legacy.declaration.end), output: applyRename(text, legacy) }
      }
      return native
    case 'script.compile':
      return legacy !== undefined
        ? { state: legacy.state, owner: /sc2 runtime codec/iu.test(legacy.reason?.message ?? '') ? 'sc2-runtime' : null }
        : native
    case 'script.references':
    case 'script.completion':
    case 'analyze-script':
    case 'to-engine':
    case 'language-at':
    case 'workspace':
      return plain(value)
    case 'language-index':
      return withoutAst(value)
    case 'script.format':
    case 'export.convert':
      return { text }
  }
  throw new Error(`unknown galaxy probe: ${probe}`)
}

/** Drives either implementation's workspace store/index through the same sequence. */
export function workspaceProbe(store, files, input) {
  for (const file of files) store.updateFile(file.name, file.text)
  const target = files[0].name
  const out = {
    files: store.listFiles().map(file => file.fileName),
    definitions: store.definitionsByName(input.symbol),
    references: store.referencesAt?.(target, input.offset) ?? null,
    definitionAt: store.definitionAt?.(target, input.offset) ?? null,
    renameEdits: store.renameEdits?.(target, input.offset) ?? null,
    completions: store.completions?.(target)?.length ?? null,
  }
  store.removeFile(files.at(-1).name)
  out.afterRemove = store.listFiles().map(file => file.fileName)
  return out
}
