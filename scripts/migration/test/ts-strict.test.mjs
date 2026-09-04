import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { auditStrictPackage } from '../lib/ts-strict.mjs'

test('strict admission rejects unchecked, excluded and JavaScript sources', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modkit-ts-admission-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'src'))
  const options = {
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noPropertyAccessFromIndexSignature: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
    preserveConstEnums: true,
    composite: true,
    declaration: true,
    declarationMap: true,
    rootDir: 'src',
    outDir: 'dist',
  }
  const config = { compilerOptions: options, include: ['src/**/*.ts'] }
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(config))
  await writeFile(path.join(root, 'src/index.ts'), 'export const number: number = 1\n')
  assert.deepEqual((await auditStrictPackage(root)).failures, [])
  await writeFile(path.join(root, 'src/left.js'), 'export const hidden = 1\n')
  assert.match((await auditStrictPackage(root)).failures.join('\n'), /JavaScript source remains/u)
  await rm(path.join(root, 'src/left.js'))
  await writeFile(
    path.join(root, 'src/unchecked.ts'),
    '// @ts-nocheck\nexport const bad: number = "text"\n',
  )
  assert.match((await auditStrictPackage(root)).failures.join('\n'), /unchecked TypeScript/u)
  config.include = ['src/index.ts']
  options.strict = false
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(config))
  const failures = (await auditStrictPackage(root)).failures.join('\n')
  assert.match(failures, /source omitted/u)
  assert.match(failures, /required compiler flag: strict/u)
})
