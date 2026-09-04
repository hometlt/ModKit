import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const flags = [
  'strict',
  'exactOptionalPropertyTypes',
  'noUncheckedIndexedAccess',
  'noPropertyAccessFromIndexSignature',
  'noImplicitOverride',
  'noFallthroughCasesInSwitch',
  'isolatedModules',
  'verbatimModuleSyntax',
  'preserveConstEnums',
  'composite',
  'declaration',
  'declarationMap',
]
export async function auditStrictPackage(directory) {
  const failures = []
  const source = path.join(directory, 'src')
  const config = path.join(directory, 'tsconfig.json')
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: diagnostic =>
        failures.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    },
  )
  if (!parsed) return { failures, typedFiles: 0 }
  for (const diagnostic of parsed.errors)
    failures.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  for (const flag of flags)
    if (parsed.options[flag] !== true) failures.push(`required compiler flag: ${flag}`)
  if (
    parsed.options.noImplicitAny === false ||
    parsed.options.strictNullChecks === false ||
    parsed.options.allowJs ||
    parsed.options.noCheck
  )
    failures.push('strict compiler bypass is forbidden')
  if (
    path.resolve(parsed.options.rootDir ?? '') !== source ||
    path.resolve(parsed.options.outDir ?? '') !== path.join(directory, 'dist')
  )
    failures.push('rootDir/outDir must be src/dist')
  const included = new Set(parsed.fileNames.map(file => path.resolve(file)))
  let typedFiles = 0
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        failures.push(`source symlink is not audited: ${file}`)
        continue
      }
      if (entry.isDirectory()) await walk(file)
      else if (/\.(?:js|jsx|mjs|cjs)$/u.test(entry.name))
        failures.push(`executable JavaScript source remains: ${file}`)
      else if (/\.(?:ts|tsx|mts|cts)$/u.test(entry.name)) {
        typedFiles++
        if (!included.has(file)) failures.push(`source omitted from TypeScript program: ${file}`)
        if (/^\s*\/\/\s*@ts-nocheck\b/mu.test(await readFile(file, 'utf8')))
          failures.push(`unchecked TypeScript source: ${file}`)
      }
    }
  }
  await walk(source)
  if (!typedFiles) failures.push('empty TypeScript source program')
  return { failures, typedFiles }
}
