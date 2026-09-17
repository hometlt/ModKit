// SC2 localization library probes, driven identically against either implementation's public API
// (MK2 pinned sc2-strings core/node; MK3 @modkit/blizzard-starcraft2/strings/core and /node).
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : item)))

/** A small deterministic catalog, the same object shape both implementations consume. */
export function resolverFrom(snapshot) {
  return {
    getResolved: (ns, id) => snapshot.entities[`${ns}/${id}`],
    getString: key => snapshot.strings[key],
    getGalaxyVar: name => snapshot.galaxyVars[name],
    getTextConstant: name => snapshot.constants[name],
    getTextStyle: name => (snapshot.styles[name] === undefined ? undefined : { name, attrs: snapshot.styles[name] }),
  }
}
export function catalogFrom(snapshot) {
  const namespaces = [...new Set(Object.keys(snapshot.entities).map(key => key.split('/')[0]))].sort()
  return {
    namespaces: () => namespaces,
    entities: ns => Object.keys(snapshot.entities).filter(key => key.startsWith(`${ns}/`)).map(key => key.slice(ns.length + 1)).sort(),
    fields: (ns, id) => Object.keys(snapshot.entities[`${ns}/${id}`] ?? {}).sort(),
    properties: () => ['Name', 'Tooltip', 'Description'],
    colors: () => Object.keys(snapshot.constants).sort(),
    colorHex: name => snapshot.constants[name],
    styles: () => Object.keys(snapshot.styles).sort(),
    assets: () => ['Icon1', 'Portrait'],
  }
}

async function gitRepo(input, run) {
  const root = path.join(os.tmpdir(), 'modkit-strings-parity-git')
  await rm(root, { recursive: true, force: true })
  await mkdir(path.join(root, 'enUS.SC2Data/LocalizedData'), { recursive: true })
  const file = path.join(root, 'enUS.SC2Data/LocalizedData/GameStrings.txt')
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=parity', '-c', 'user.email=parity@example.invalid', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' })
  try {
    git('init', '-q')
    for (const [index, text] of input.revisions.entries()) {
      await writeFile(file, text)
      if (index < input.revisions.length - 1 || input.commitLast) { git('add', '.'); git('commit', '-q', '-m', `r${index}`) }
    }
    return await run(root, file)
  } finally { await rm(root, { recursive: true, force: true }) }
}

export async function drive(api, input, text) {
  const snapshot = input.snapshot
  switch (input.probe) {
    case 'tokenize':
      return input.values.map(value => ({ value: plain(api.tokenizeStringValue(value)), plainText: plain(api.tokenizeStringValue(value, false)) }))
        .concat(input.keys.map(key => ({ key: plain(api.tokenizeStringKey(key)) })))
    case 'complete':
      return input.points.map(([kind, value, offset]) => {
        const catalog = catalogFrom(snapshot)
        return kind === 'key'
          ? plain(api.completeStringKey({ text: value, offset, catalog }))
          : {
              result: plain(api.completeStringValue({ text: value, offset, catalog })),
              bare: plain(api.completeStringValue({ text: value, offset })),
              doc: plain(api.findTagOrAttrDocAt(value, offset)),
            }
      }).concat([['ref', 'Ref', 'value', 'color'].map(name => api.isReferenceAttribute(name))])
    case 'markup':
      return input.values.map(value => ({
        parsed: plain(api.parseMarkup(value)),
        serialized: api.serializeMarkup(api.parseMarkup(value)),
        refs: plain(api.markupCatalogRefs(value)),
        bracketed: plain(api.parseBracketedDTag(value)),
        syntax: plain(api.validateMarkupSyntax(value)),
        colors: plain(api.findColorSwatches(value)),
        at: [0, 3, Math.floor(value.length / 2), value.length].map(offset => plain(api.findSegmentAt(value, offset))),
      }))
    case 'resolve': {
      const resolver = resolverFrom(snapshot)
      return {
        values: input.values.map(value => {
          const resolved = api.resolveStringValue(value, resolver)
          return {
            resolved: plain(resolved),
            plain: api.renderPlain(resolved.segments),
            html: api.renderMarkupHtml(resolved.segments),
            htmlOptions: api.renderMarkupHtml(resolved.segments, input.htmlOptions ?? {}),
          }
        }),
        refs: plain(api.validateStringRefs(input.values.map((value, index) => [`K${index}`, value]), resolver)),
        paths: input.paths.map(([id, fieldPath]) => plain(api.resolveFieldPath(snapshot.entities[id], fieldPath))),
      }
    }
    case 'constants':
      return {
        locales: plain(api.SC2_LOCALES),
        catalogs: plain(api.STRING_CATALOGS),
        canonical: input.codes.map(code => [api.canonicalLocale(code) ?? null, plain(api.localeInfo(code))]),
        files: input.stems.map(stem => api.canonicalStringFile(stem)),
        index: plain(api.parseIndexSc2Locale(input.localeXml)),
      }
    case 'analysis': {
      const model = api.parseSc2StringsOrdered(new TextEncoder().encode(text))
      return {
        bare: plain(api.analyzeStringFile(model)),
        resolved: plain(api.analyzeStringFile(model, resolverFrom(snapshot))),
      }
    }
    case 'diff':
      return {
        texts: plain(api.diffStringTexts(input.before, text)),
        unified: plain(api.parseStringFileDiff(input.unified)),
      }
    case 'git':
      return gitRepo(input, async (root, file) => {
        const changes = plain(await api.gitDiffStrings({ cwd: root, file, fromRef: 'HEAD' }))
        const refs = input.commitLast ? plain(await api.gitDiffStrings({ cwd: root, file: 'enUS.SC2Data/LocalizedData/GameStrings.txt', fromRef: 'HEAD~1', toRef: 'HEAD' })) : null
        const staged = await api.stageChangedStrings({ cwd: root, file, fromRef: 'HEAD~0', outDir: path.join(root, 'stage') })
        return { changes, refs, stagedChanges: plain(staged.changes), stagedText: await readFile(staged.file, 'utf8') }
      })
  }
  throw new Error(`unknown strings probe: ${input.probe}`)
}
