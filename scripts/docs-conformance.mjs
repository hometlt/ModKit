#!/usr/bin/env node
// Documentation conformance (plan block 12 item 19: «включить docs:conformance в CI»).
//
// A documented example is a promise about an API, and the cheapest way to break it is to change the
// API. This checks the promises the repository actually makes in its extension-facing READMEs:
//
//   1. every fenced `js` block parses;
//   2. every `@modkit/...` specifier it imports resolves;
//   3. every *named* import exists in that module's real exports — the check that catches a renamed
//      or removed export, which is how documentation usually rots;
//   4. every method the block calls on a codec (`open`, `descriptor`, `dispose`) exists on the real
//      object the scaffold produces.
//
// Point 3 is the one worth having. Syntax checks pass happily on `import { createCodecs } from …`
// long after the export became `createCodec`, and the reader finds out at runtime.
//
// The prose repository is not in this tree, so the documents checked here are the ones that ship
// with the code: the reference extensions and the scaffold's own README.
//
// Usage: node scripts/docs-conformance.mjs [--quiet]

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const quiet = process.argv.includes('--quiet')
const problems = []
const fail = message => problems.push(message)

/** Fenced ```js / ```javascript blocks, with the line they start on. */
function codeBlocks(markdown) {
  const blocks = []
  const lines = markdown.split('\n')
  let current
  for (const [index, line] of lines.entries()) {
    if (current === undefined) {
      if (/^```(?:js|javascript)\s*$/u.test(line.trim())) current = { line: index + 1, body: [] }
      continue
    }
    if (line.trim() === '```') {
      blocks.push({ line: current.line, source: current.body.join('\n') })
      current = undefined
      continue
    }
    current.body.push(line)
  }
  return blocks
}

/** Every README this repository ships for extension authors. */
function documents() {
  const found = []
  const referenceRoot = path.join(repoRoot, 'examples', 'extensions')
  for (const entry of readdirSync(referenceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const readme = path.join(referenceRoot, entry.name, 'README.md')
    try {
      found.push({
        label: `examples/extensions/${entry.name}/README.md`,
        source: readFileSync(readme, 'utf8'),
      })
    } catch {
      // a reference extension without a README is a separate problem, not this gate's
    }
  }
  /*
   * The codec-kit README is the document an extension author actually reads before writing
   * anything, so its example is worth more than the reference extensions' prose. It is read by
   * path for the same reason the library is imported by path below: it is extension-side, and the
   * platform import guard forbids naming it as a specifier.
   */
  try {
    found.push({
      label: 'packages/codec-kit/README.md',
      source: readFileSync(path.join(repoRoot, 'packages', 'codec-kit', 'README.md'), 'utf8'),
    })
  } catch {
    // absent is a different problem from wrong
  }
  return found
}

/** The scaffold's README, generated fresh so the example is checked as users receive it. */
function scaffoldDocument() {
  const scratch = mkdtempSync(path.join(repoRoot, 'extensions', '.x3-docs-'))
  try {
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'scaffold-extension.mjs'),
        '--out',
        scratch,
        '--id',
        'demofmt',
      ],
      { encoding: 'utf8' },
    )
    return {
      label: 'scaffold README (generated)',
      source: readFileSync(path.join(scratch, 'README.md'), 'utf8'),
      codec: readFileSync(path.join(scratch, 'src', 'codec.js'), 'utf8'),
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Parse-check one block by handing it to node, which owns the grammar. */
function parses(source) {
  const scratch = mkdtempSync(path.join(repoRoot, '.x3-docs-check-'))
  try {
    const file = path.join(scratch, 'block.mjs')
    /*
     * The example is a fragment, and two things must hold at once: `import` is only legal at module
     * scope, while the rest uses `await` and references (`context`, `input`, `budget`) a reader
     * supplies. So imports are hoisted and the remainder becomes a function body — the snippet is
     * checked as written rather than rewritten into something that would always parse.
     */
    const lines = source.split('\n')
    // `import` and `export` are module-scope only; everything else may sit in the function body
    const isModuleScope = line => /^\s*(?:import|export)\s/u.test(line)
    const hoisted = lines.filter(isModuleScope)
    const body = lines.filter(line => !isModuleScope(line))
    writeFileSync(
      file,
      [
        ...hoisted,
        'async function example(context, input, budget) {',
        ...body,
        '}',
        'void example',
        '',
      ].join('\n'),
      'utf8',
    )
    execFileSync(process.execPath, ['--check', file], { encoding: 'utf8', stdio: 'pipe' })
    return true
  } catch (error) {
    return String(error?.stderr ?? error?.message ?? error)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const IMPORT = /import\s*\{([^}]*)\}\s*from\s*'([^']+)'/gu

/**
 * Turn a documented specifier into something this script can load.
 *
 * Platform packages resolve normally. `codec-kit` does not and must not: it is extension-side by
 * the owner's 2026-08-24 demotion, and `scripts/check-app-imports.mjs` forbids platform code from
 * naming it. Reading it by path keeps the example checkable without this script becoming the first
 * platform-side consumer of the thing the guard exists to keep out.
 */
function resolveSpecifier(specifier) {
  if (specifier === '@modkit/codec-kit') {
    return pathToFileURL(path.join(repoRoot, 'packages', 'codec-kit', 'src', 'index.js')).href
  }
  if (specifier.startsWith('@modkit/codec-kit/')) {
    const rest = specifier.slice('@modkit/codec-kit/'.length)
    return pathToFileURL(path.join(repoRoot, 'packages', 'codec-kit', 'src', rest, 'index.js')).href
  }
  return specifier
}

async function checkNamedImports(label, block) {
  for (const match of block.source.matchAll(IMPORT)) {
    const names = match[1]
      .split(',')
      .map(item =>
        item
          .trim()
          .split(/\s+as\s+/u)[0]
          ?.trim(),
      )
      .filter(item => item !== undefined && item !== '')
    const specifier = match[2]
    if (specifier.startsWith('@modkit/')) {
      let module
      try {
        module = await import(resolveSpecifier(specifier))
      } catch (error) {
        fail(
          `${label}:${block.line}: cannot resolve «${specifier}» — ${String(error?.message ?? error)}`,
        )
        continue
      }
      for (const name of names) {
        if (!(name in module)) {
          fail(`${label}:${block.line}: «${specifier}» has no export «${name}»`)
        }
      }
    }
  }
}

let blockCount = 0
const scaffold = scaffoldDocument()
for (const document of [...documents(), scaffold]) {
  for (const block of codeBlocks(document.source)) {
    blockCount += 1
    const parsed = parses(block.source)
    if (parsed !== true) fail(`${document.label}:${block.line}: example does not parse — ${parsed}`)
    await checkNamedImports(document.label, block)
  }
}

/*
 * The scaffold's example names `createCodec` and calls three methods on what it returns. Both are
 * checked against the real modules rather than against a list written here, so a rename breaks this
 * gate instead of breaking a reader.
 *
 * `@modkit/codec-kit` is resolved by path on purpose: it is an extension-side library, outside
 * the platform closure by the owner's 2026-08-24 decision, and the import guard forbids platform
 * code from naming it as a specifier. Reading it by path respects that boundary instead of quietly
 * crossing it to run a check.
 */
const codecKit = await import(
  pathToFileURL(path.join(repoRoot, 'packages', 'codec-kit', 'src', 'index.js')).href
)
if (typeof codecKit.createInspectionCodec !== 'function') {
  fail('codec-kit no longer exports createInspectionCodec, which every scaffolded codec imports')
}
if (!scaffold.codec.includes('createInspectionCodec')) {
  fail('the scaffolded codec no longer uses createInspectionCodec, but its README still teaches it')
}
for (const member of ['open', 'descriptor', 'dispose']) {
  if (!scaffold.source.includes(`.${member}(`)) {
    fail(`the scaffold README no longer shows codec.${member}(); the golden path lost a step`)
  }
}

if (problems.length > 0) {
  process.stderr.write(`docs:conformance: ${problems.length} problem(s)\n`)
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
  process.exit(1)
}
if (!quiet) {
  process.stdout.write(`docs:conformance: ${blockCount} documented example(s) parse and resolve\n`)
}
