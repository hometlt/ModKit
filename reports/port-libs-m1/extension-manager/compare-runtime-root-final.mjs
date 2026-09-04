import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createHash } from 'node:crypto'
const core = path.resolve('modkit-core'), out = path.resolve('artifacts/legacy-parity-sc2/m1-2026-09-04/extension-manager-ts/root-final')
const ts = createRequire(path.join(core, 'package.json'))('typescript')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const files = execFileSync('git', ['-C', core, 'ls-tree', '--name-only', 'HEAD', 'packages/extension-manager/src/'], { encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.js'))
if (files.length !== 15) throw new Error('Expected fifteen original JavaScript sources');
await mkdir(out, { recursive: true })
function normalize(source, file) {
  const emitted = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true, useDefineForClassFields: true } }).outputText
  const parsed = ts.createSourceFile('emitted.js', emitted, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
  const value = node => {
    if (ts.isShorthandPropertyAssignment(node) && node.name.text !== '__proto__' && !node.objectAssignmentInitializer) return { kind: 'PropertyAssignment', children: [value(node.name), value(node.name)] }
    if (ts.isParenthesizedExpression(node)) return value(node.expression)
    if (ts.isPropertyAccessExpression(node)) return { kind: 'StaticMember', optional: Boolean(node.questionDotToken), receiver: value(node.expression), property: node.name.text }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return { kind: 'StaticMember', optional: Boolean(node.questionDotToken), receiver: value(node.expression), property: node.argumentExpression.text }
    const children = []; ts.forEachChild(node, child => { children.push(value(child)) })
    return { kind: ts.SyntaxKind[node.kind], ...(node.text === undefined || ts.isSourceFile(node) ? {} : { text: node.text }), ...(children.length ? { children } : {}) }
  }
  return { emitted, tree: value(parsed) }
}
const comparisons = []
for (const original of files) {
  const destination = original.replace(/\.js$/u, '.ts')
  const before = execFileSync('git', ['-C', core, 'show', `HEAD:${original}`], { encoding: 'utf8' })
  const after = await readFile(path.join(core, destination), 'utf8')
  const old = normalize(before, original), current = normalize(after, destination)
  const equal = JSON.stringify(old.tree) === JSON.stringify(current.tree)
  comparisons.push({ original, destination, originalSha256: sha256(before), destinationSha256: sha256(after), originalRuntimeSha256: sha256(JSON.stringify(old.tree)), destinationRuntimeSha256: sha256(JSON.stringify(current.tree)), equal })
  {
    await writeFile(path.join(out, `${path.basename(original)}.before.js`), old.emitted)
    await writeFile(path.join(out, `${path.basename(original)}.after.js`), current.emitted)
  }
  console.log(`${equal ? 'equal' : 'DIFF'} ${original}`)
}
await writeFile(path.join(out, 'runtime-comparison.json'), JSON.stringify({ schemaVersion: 1, originalCommit: execFileSync('git', ['-C', core, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), normalization: 'TypeScript transpile ESNext removes types/comments; structural JS AST ignores source positions/parentheses and equates dot/static-string property access plus ordinary shorthand properties with explicit same-identifier assignments (excluding __proto__). Preserves identifiers/literals/operators/control flow/defaults/undefined keys.', files: comparisons, verdict: comparisons.every(record => record.equal) ? 'pass' : 'fail' }, null, 2) + '\n')
if (comparisons.some(record => !record.equal)) process.exitCode = 1

