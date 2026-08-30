import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function packFirstParty({ packageRoot, destination }) {
  const source = resolve(packageRoot)
  const output = resolve(destination)
  const metadataPath = join(source, 'package.json')
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  if (metadata.license !== 'MIT') {
    throw new Error(`staged first-party pack requires package.json license=MIT: ${metadataPath}`)
  }
  const stagingParent = mkdtempSync(join(tmpdir(), 'modkit-first-party-pack-'))
  const stage = join(stagingParent, basename(source))
  try {
    cpSync(source, stage, {
      recursive: true,
      filter: path => !/(?:^|[\\/])(?:node_modules|coverage)(?:[\\/]|$)/u.test(path),
    })
    mkdirSync(join(stage, 'licenses'), { recursive: true })
    cpSync(join(repoRoot, 'licenses', 'MIT.txt'), join(stage, 'licenses', 'MIT.txt'))
    const stagedMetadata = {
      ...metadata,
      files: [...new Set([...(metadata.files ?? []), 'licenses/MIT.txt'])],
    }
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(stagedMetadata, null, 2)}\n`)
    mkdirSync(output, { recursive: true })
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const command = process.platform === 'win32' ? process.execPath : 'npm'
    const commandArguments = [
      ...(process.platform === 'win32' ? [npmCli] : []),
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      output,
    ]
    const result = spawnSync(command, commandArguments, {
      cwd: stage,
      encoding: 'utf8',
    })
    if (result.status !== 0)
      throw new Error(
        `npm pack failed:\n${result.error?.message ?? result.stderr ?? result.stdout}`,
      )
    return JSON.parse(result.stdout)
  } finally {
    rmSync(stagingParent, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageValue = argument('--package')
  if (packageValue === undefined)
    throw new Error('usage: --package <directory> [--destination <directory>]')
  const packageRoot = isAbsolute(packageValue) ? packageValue : resolve(process.cwd(), packageValue)
  const destinationValue = argument('--destination') ?? process.cwd()
  const destination = isAbsolute(destinationValue)
    ? destinationValue
    : resolve(process.cwd(), destinationValue)
  console.log(JSON.stringify(packFirstParty({ packageRoot, destination }), null, 2))
}
