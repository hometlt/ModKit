/** Pinned MK2 source access and a reproducible, host-isolated Node oracle. */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  realpath,
  chmod,
  symlink,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MK2_PIN = '1a14ba4eddd0ae88de273348ebd44cfb98a0581d'
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  if (typeof value === 'bigint') return JSON.stringify(`${value}n`)
  if (value === undefined) throw new Error('Undefined is not a reproducible oracle input')
  return JSON.stringify(value)
}
export const digestManifest = value => sha256(stableJson(value))

function parseJsonConfig(text) {
  let output = ''
  let quoted = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      output += char
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++
      output += '\n'
    } else if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++
      if (index >= text.length) throw new Error('Unclosed tsconfig comment')
      index++
    } else output += char
  }
  let cleaned = ''
  quoted = false
  escaped = false
  for (let index = 0; index < output.length; index++) {
    const char = output[index]
    if (quoted) {
      cleaned += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      cleaned += char
    } else if (char !== ',' || !/^\s*[}\]]/u.test(output.slice(index + 1))) cleaned += char
  }
  return JSON.parse(cleaned)
}

function relativePath(value) {
  const normalized = value.replaceAll('\\', '/')
  if (
    !normalized ||
    path.isAbsolute(value) ||
    /^[a-z]:/iu.test(value) ||
    normalized.split('/').some(part => part === '..' || part === '')
  )
    throw new Error(`Unsafe oracle path: ${value}`)
  return normalized.replace(/^\.\//u, '')
}

/** Reads git blobs, never executes or repairs the dirty checkout. */
export async function createPinnedSource({
  repoRoot,
  commit = MK2_PIN,
  observeWorkingTree = true,
}) {
  repoRoot = path.resolve(repoRoot)
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Oracle commit must be a full immutable SHA')
  if (typeof observeWorkingTree !== 'boolean') throw new Error('observeWorkingTree must be boolean')
  const git = (args, options = {}) =>
    execFileSync('git', ['-C', repoRoot, ...args], {
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
      ...options,
    })
  const resolved = git(['rev-parse', `${commit}^{commit}`])
    .toString()
    .trim()
  if (resolved !== commit) throw new Error('Oracle commit did not resolve exactly')
  const files = new Map(
    git(['ls-tree', '-r', '-z', commit])
      .toString()
      .split('\0')
      .filter(Boolean)
      .map(line => {
        const [header, file] = line.split('\t')
        const [mode, type, blob] = header.split(' ')
        return [file, { mode, type, blob }]
      }),
  )
  const reads = new Map()
  const pinnedBytes = new Map()
  const prefetch = requested => {
    const paths = [...new Set(requested.map(relativePath))]
    const blobs = []
    for (const file of paths) {
      const item = files.get(file)
      if (!item || item.type !== 'blob' || item.mode === '120000')
        throw new Error(`Missing or unsafe pinned source: ${file}`)
      if (!pinnedBytes.has(item.blob)) blobs.push(item.blob)
    }
    if (!blobs.length) return
    const output = git(['cat-file', '--batch'], {
      input: Buffer.from(`${blobs.join('\n')}\n`),
      maxBuffer: 1024 * 1024 * 1024,
    })
    let offset = 0
    for (const expected of blobs) {
      const newline = output.indexOf(0x0a, offset)
      if (newline < 0) throw new Error('Truncated pinned Git batch header')
      const [actual, type, sizeText] = output.subarray(offset, newline).toString().split(' ')
      const size = Number(sizeText)
      if (actual !== expected || type !== 'blob' || !Number.isSafeInteger(size) || size < 0)
        throw new Error(`Invalid pinned Git batch record: ${expected}`)
      const start = newline + 1
      const end = start + size
      if (end >= output.length || output[end] !== 0x0a)
        throw new Error(`Truncated pinned Git batch blob: ${expected}`)
      pinnedBytes.set(expected, Buffer.from(output.subarray(start, end)))
      offset = end + 1
    }
    if (offset !== output.length) throw new Error('Unexpected trailing pinned Git batch data')
  }
  return {
    repoRoot,
    commit,
    listFiles: () => [...files.keys()].sort(),
    has: file => files.has(relativePath(file)),
    prefetch,
    async read(file) {
      file = relativePath(file)
      const item = files.get(file)
      if (!item || item.type !== 'blob' || item.mode === '120000')
        throw new Error(`Missing or unsafe pinned source: ${file}`)
      if (!reads.has(file))
        reads.set(
          file,
          (async () => {
            if (!pinnedBytes.has(item.blob)) prefetch([file])
            const bytes = pinnedBytes.get(item.blob)
            let workingTreeSha256 = null
            if (observeWorkingTree) {
              try {
                workingTreeSha256 = sha256(await readFile(path.join(repoRoot, file)))
              } catch (error) {
                if (error.code !== 'ENOENT') throw error
              }
            }
            const hash = sha256(bytes)
            return {
              bytes,
              path: file,
              sha256: hash,
              gitBlob: item.blob,
              workingTreeSha256,
              workingTreeMatchesPin: observeWorkingTree ? workingTreeSha256 === hash : null,
            }
          })(),
        )
      const record = await reads.get(file)
      return { ...record, bytes: Buffer.from(record.bytes) }
    },
  }
}

/** Ordered files matter: a changed order is a changed sampling input. */
export async function createCorpusManifest(files, { roots = [], selection = {} } = {}) {
  if (!files.length) throw new Error('Oracle corpus manifest cannot be empty')
  const entries = []
  for (const file of files) {
    const bytes = await readFile(file)
    entries.push({ path: path.resolve(file), byteLength: bytes.length, sha256: sha256(bytes) })
  }
  return { roots: roots.map(root => path.resolve(root)), selection, files: entries }
}

function exportTarget(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(exportTarget).find(Boolean)
  if (value && typeof value === 'object')
    return (
      exportTarget(value.node) ??
      exportTarget(value.import) ??
      exportTarget(value.default) ??
      exportTarget(value.types)
    )
}

function targetFor(manifest, subpath) {
  const exports = manifest.exports
  if (
    typeof exports === 'string' ||
    (exports && !Object.keys(exports).some(key => key.startsWith('.')))
  )
    return subpath === '.' ? exportTarget(exports) : undefined
  if (exports?.[subpath]) return exportTarget(exports[subpath])
  for (const [key, value] of Object.entries(exports ?? {})) {
    const star = key.indexOf('*')
    if (star < 0) continue
    if (subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1))) {
      const capture = subpath.slice(star, subpath.length - (key.length - star - 1))
      return exportTarget(value)?.replaceAll('*', capture)
    }
  }
  if (!exports && subpath === '.') return manifest.main ?? './index.js'
}

const TEMPLATE_IMPORT =
  /import\(\s*(?:\/\*[\s\S]*?\*\/\s*)?`(\.\.?\/[^`$]*)\$\{([^}`]+)\}([^`$]*)`\s*\)/gu

/**
 * Pinned sources are served from a virtual namespace, where esbuild cannot expand a
 * template-literal dynamic import (`import(\`./data/protocol${build}.js\`)`) by scanning a
 * directory. Rewrite each one into an explicit map over the matching pinned files (sorted, so
 * the bundle is deterministic); an unmatched key rejects exactly like a missing module.
 */
export function expandTemplateImports(contents, importer, files) {
  const helpers = []
  const rewritten = contents.replace(TEMPLATE_IMPORT, (_match, prefix, expression, suffix) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), prefix))
    const extensions = /\.m?js$/u.test(suffix) ? [suffix, suffix.replace(/\.m?js$/u, '.ts')] : [suffix]
    const keys = new Set()
    for (const file of files) {
      if (!file.startsWith(base)) continue
      const extension = extensions.find(item => file.endsWith(item))
      if (extension === undefined) continue
      const middle = file.slice(base.length, file.length - extension.length)
      if (!middle || middle.includes('/')) continue
      keys.add(`${prefix}${middle}${suffix}`)
    }
    const name = `__mk2TemplateImport${helpers.length}`
    const entries = [...keys].sort().map(key => `${JSON.stringify(key)}: () => import(${JSON.stringify(key)})`)
    helpers.push(
      `const ${name} = key => { const load = ({ ${entries.join(', ')} })[key]; ` +
        `return load === undefined ? Promise.reject(new Error('Unknown pinned dynamic import: ' + key)) : load() };`,
    )
    return `${name}(\`${prefix}\${${expression}}${suffix}\`)`
  })
  return helpers.length === 0 ? contents : `${helpers.join('\n')}\n${rewritten}`
}

function sourceCandidates(file) {
  const values = [
    file.replace(/\/dist\/src\//u, '/src/'),
    file.replace(/\/dist\//u, '/src/'),
    file.replace(/\/dist\//u, '/'),
    file,
  ]
  return [
    ...new Set(
      values.flatMap(value => [
        value.replace(/\.d\.ts$/u, '.ts').replace(/\.m?js$/u, '.ts'),
        value,
        `${value}.ts`,
        `${value}/index.ts`,
      ]),
    ),
  ]
}

async function packageFiles(root) {
  const records = []
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile())
        records.push({
          path: path.relative(root, file).replaceAll('\\', '/'),
          sha256: sha256(await readFile(file)),
        })
      else throw new Error(`Unsupported dependency link: ${file}`)
    }
  }
  await visit(root)
  return records
}

/**
 * Publish immutable cache bytes atomically. `writeFile(..., { flag: 'wx' })` exposes the destination
 * before the write is complete, so two concurrent oracle rows can observe a partial esbuild binary
 * or pinned data file. A complete temporary file plus one rename keeps the shared cache readable at
 * every instant; the winner and loser both verify the final digest.
 */
async function ensureImmutableFile(destination, bytes, expectedSha256, label) {
  try {
    if (sha256(await readFile(destination)) !== expectedSha256) {
      throw new Error(`Corrupt ${label}: ${destination}`)
    }
    return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    if (sha256(await readFile(temporary)) !== expectedSha256) {
      throw new Error(`Corrupt temporary ${label}: ${temporary}`)
    }
    await chmod(temporary, 0o444)
    try {
      await rename(temporary, destination)
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error
    }
  } finally {
    await rm(temporary, { force: true })
  }
  if (sha256(await readFile(destination)) !== expectedSha256) {
    throw new Error(`Corrupt ${label}: ${destination}`)
  }
  await chmod(destination, 0o444)
}

export async function loadMk2(entry, options = {}) {
  const {
    repoRoot,
    commit = MK2_PIN,
    cacheDir,
    operation = 'module-load',
    operationOptions = {},
    corpusManifest = { kind: 'no-corpus-module-load' },
    additionalFiles = [],
    runtimeDependencies = [],
    stubs = [],
    loaderFiles = [],
    workspaceScopes = ['@modkitx'],
    observeWorkingTree = true,
  } = options
  if (!repoRoot || !cacheDir) throw new Error('repoRoot and cacheDir are required')
  const source = await createPinnedSource({ repoRoot, commit, observeWorkingTree })
  entry = relativePath(entry)
  const inputs = new Map()
  const pinnedSnapshotRoot = path.resolve(
    cacheDir,
    'snapshots',
    commit,
    digestManifest({ entry, additionalFiles, stubPaths: stubs.map(stub => stub.path) }),
  )
  const read = async file => {
    const record = await source.read(file)
    inputs.set(file, record)
    const destination = path.join(pinnedSnapshotRoot, file)
    await ensureImmutableFile(destination, record.bytes, record.sha256, 'pinned snapshot')
    return record.bytes.toString('utf8')
  }
  const rootRequire = createRequire(path.join(source.repoRoot, 'package.json'))
  const engineRequire = createRequire(import.meta.url)
  const esbuild = engineRequire('esbuild')
  const externalPackages = new Map()
  const externalResolutions = new Map()
  async function dependency(root) {
    root = await realpath(root)
    if (externalPackages.has(root)) return
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    const record = {
      root,
      name: manifest.name,
      version: manifest.version,
      files: await packageFiles(root),
      dependencies: {},
    }
    externalPackages.set(root, record)
    // Peers resolve from the installed package's own context, just as they do at runtime.
    // Omitting a required peer leaves an otherwise complete snapshot unable to import it.
    const dependencyNames = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    for (const name of [...dependencyNames].sort()) {
      const request = createRequire(path.join(root, 'package.json'))
      let manifestPath
      try {
        try {
          manifestPath = request.resolve(`${name}/package.json`)
        } catch {
          const resolved = request.resolve(name)
          let current = path.dirname(resolved)
          while (current !== path.dirname(current)) {
            try {
              if (
                JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8')).name === name
              ) {
                manifestPath = path.join(current, 'package.json')
                break
              }
            } catch (error) {
              if (error.code !== 'ENOENT') throw error
            }
            current = path.dirname(current)
          }
        }
      } catch (error) {
        if (
          error.code === 'MODULE_NOT_FOUND' &&
          manifest.peerDependenciesMeta?.[name]?.optional === true &&
          !Object.hasOwn(manifest.dependencies ?? {}, name)
        )
          continue
        throw error
      }
      if (!manifestPath) throw new Error(`Missing transitive dependency: ${name}`)
      record.dependencies[name] = await realpath(path.dirname(manifestPath))
      await dependency(path.dirname(manifestPath))
    }
  }
  async function resolveExternal(specifier, importer) {
    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0]
    const request = importer ? createRequire(path.join(source.repoRoot, importer)) : rootRequire
    let root
    try {
      root = path.dirname(request.resolve(`${name}/package.json`))
    } catch {
      let current = path.dirname(request.resolve(specifier))
      while (current !== path.dirname(current)) {
        try {
          if (
            JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8')).name === name
          ) {
            root = current
            break
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        current = path.dirname(current)
      }
    }
    if (!root) throw new Error(`Missing dependency ${specifier}`)
    await dependency(root)
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`
    const target = targetFor(manifest, subpath)
    let resolved
    if (target) {
      const exactTarget = path.resolve(root, target)
      try {
        await readFile(exactTarget)
        resolved = exactTarget
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        // Legacy CommonJS packages often publish an extensionless `main` (for example
        // xml2js -> "./lib/xml2js") and rely on Node's normal .js/index.js resolution.
        // Preserve the package's declared target as the first choice, then delegate only the
        // missing-file case to the same importer-scoped resolver Node would use at runtime.
        resolved = request.resolve(specifier)
      }
    } else resolved = request.resolve(specifier)
    await readFile(resolved) // Missing WASM/module data is an error, never an empty oracle result.
    const url = pathToFileURL(resolved).href
    externalResolutions.set(url, {
      root: await realpath(root),
      relative: path.relative(root, resolved),
    })
    return url
  }
  const packageRoots = new Map()
  async function resolveWorkspace(specifier) {
    const [scope, name, ...rest] = specifier.split('/')
    const fullName = `${scope}/${name}`
    let directory = packageRoots.get(fullName)
    if (!directory) {
      const simple = `packages/${name}/package.json`
      const manifests = source.has(simple)
        ? [simple]
        : source
            .listFiles()
            .filter(file => /^(packages|extensions)\/.+\/package\.json$/u.test(file))
      for (const file of manifests) {
        const manifest = JSON.parse(await read(file))
        if (manifest.name === fullName) {
          directory = path.posix.dirname(file)
          packageRoots.set(fullName, directory)
          break
        }
      }
    }
    if (!directory) throw new Error(`No pinned workspace package: ${specifier}`)
    const manifest = JSON.parse(await read(`${directory}/package.json`))
    const target = targetFor(manifest, rest.length ? `./${rest.join('/')}` : '.')
    if (!target) throw new Error(`Pinned exports do not expose: ${specifier}`)
    const candidates = sourceCandidates(path.posix.normalize(`${directory}/${target}`))
    const resolved = candidates.find(file => source.has(file) && !file.endsWith('.d.ts'))
    if (!resolved) throw new Error(`No pinned source for ${specifier}: ${candidates.join(', ')}`)
    return resolved
  }
  const stubMap = new Map()
  for (const stub of stubs) {
    if (
      stub.kind !== 'host-registry' ||
      !stub.reason ||
      !/(registry|registries|catalog)/u.test(stub.path)
    )
      throw new Error('Only explicit, justified host-registry stubs are accepted')
    if (stubMap.has(stub.path)) throw new Error(`Duplicate host stub: ${stub.path}`)
    await read(stub.path)
    stubMap.set(stub.path, stub)
  }
  const configs = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'tsconfig.base.json',
  ].filter(file => source.has(file))
  for (const file of [...configs, ...additionalFiles]) await read(file)
  const compilerOptions = source.has('tsconfig.base.json')
    ? parseJsonConfig(await read('tsconfig.base.json')).compilerOptions
    : {}
  const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])
  const result = await esbuild.build({
    entryPoints: [entry],
    absWorkingDir: source.repoRoot,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    metafile: true,
    logLevel: 'silent',
    tsconfigRaw: { compilerOptions: { ...compilerOptions, experimentalDecorators: true } },
    plugins: [
      {
        name: 'pinned-mk2',
        setup(build) {
          build.onResolve({ filter: /.*/ }, async args => {
            if (builtins.has(args.path)) return { path: args.path, external: true }
            if (args.kind === 'entry-point') return { path: entry, namespace: 'mk2-pin' }
            let resolved
            if (workspaceScopes.some(scope => args.path.startsWith(`${scope}/`)))
              resolved = await resolveWorkspace(args.path)
            else if (args.path.startsWith('.')) {
              const candidate = path.posix.normalize(
                path.posix.join(path.posix.dirname(args.importer), args.path),
              )
              resolved = sourceCandidates(candidate).find(file => source.has(file))
              if (!resolved)
                throw new Error(`Missing pinned import ${args.path} from ${args.importer}`)
            } else return { path: await resolveExternal(args.path, args.importer), external: true }
            return { path: resolved, namespace: 'mk2-pin' }
          })
          build.onLoad({ filter: /.*/, namespace: 'mk2-pin' }, async args => {
            const original = await read(args.path)
            const contents = expandTemplateImports(
              stubMap.get(args.path)?.source ?? original,
              args.path,
              source.listFiles(),
            )
            const ext = path.extname(args.path)
            if (ext === '.json') return { contents, loader: 'json' }
            const transformed = await esbuild.transform(contents, {
              loader: ext === '.tsx' ? 'tsx' : /\.[cm]?ts$/u.test(ext) ? 'ts' : 'js',
              target: 'es2022',
              tsconfigRaw: {
                compilerOptions: { ...compilerOptions, experimentalDecorators: true },
              },
              define: {
                'import.meta.url': JSON.stringify(
                  pathToFileURL(path.join(pinnedSnapshotRoot, args.path)).href,
                ),
              },
            })
            // Keep TypeScript semantics for the bundle step: esbuild then tolerates imports that
            // name type-only re-exports (`export { SomeType } from './types'`) in pinned barrels.
            return { contents: transformed.code, loader: /\.[cm]?tsx?$/u.test(ext) ? 'ts' : 'js' }
          })
        },
      },
    ],
  })
  for (const declared of runtimeDependencies) {
    await resolveExternal(declared.name, entry)
    const record = [...externalPackages.values()].find(item => item.name === declared.name)
    for (const required of declared.files ?? []) {
      if (!record?.files.some(item => item.path === relativePath(required)))
        throw new Error(`Missing required runtime dependency file: ${declared.name}/${required}`)
    }
  }
  await dependency(path.dirname(engineRequire.resolve('esbuild/package.json')))
  const platformPackage = `@esbuild/${process.platform}-${process.arch}`
  const esbuildRequire = createRequire(engineRequire.resolve('esbuild/package.json'))
  await dependency(path.dirname(esbuildRequire.resolve(`${platformPackage}/package.json`)))
  // Include the actual esbuild platform binary as well as its JavaScript package.
  const esbuildBinary = path.join(
    path.dirname(esbuildRequire.resolve(`${platformPackage}/package.json`)),
    process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild',
  )
  const binaryDigest = sha256(await readFile(esbuildBinary))
  const sourceRecords = [...inputs.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ bytes, ...record }) => {
      void bytes
      return record
    })
  const loader = []
  for (const file of [fileURLToPath(import.meta.url), ...loaderFiles])
    loader.push({
      path: path.resolve(file instanceof URL ? fileURLToPath(file) : file),
      sha256: sha256(await readFile(file)),
    })
  const dependencies = [...externalPackages.values()].sort((a, b) => a.root.localeCompare(b.root))
  // External libraries keep import.meta.url / WASM file layout, but execute immutable snapshots.
  const dependencyDirectory = path.resolve(cacheDir, 'dependencies', digestManifest(dependencies))
  const snapshotRoot = root => path.join(dependencyDirectory, sha256(root))
  for (const record of dependencies) {
    for (const item of record.files) {
      const destination = path.join(snapshotRoot(record.root), item.path)
      const bytes = await readFile(path.join(record.root, item.path))
      if (sha256(bytes) !== item.sha256)
        throw new Error(`Dependency changed during load: ${record.name}/${item.path}`)
      await ensureImmutableFile(destination, bytes, item.sha256, 'dependency snapshot')
    }
  }
  for (const record of dependencies)
    for (const [name, root] of Object.entries(record.dependencies)) {
      const link = path.join(snapshotRoot(record.root), 'node_modules', name)
      await mkdir(path.dirname(link), { recursive: true })
      try {
        await symlink(snapshotRoot(root), link, process.platform === 'win32' ? 'junction' : 'dir')
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      if ((await realpath(link)) !== (await realpath(snapshotRoot(root))))
        throw new Error(`Corrupt dependency link: ${link}`)
    }
  const identity = {
    schemaVersion: 1,
    oracleCommit: commit,
    entry,
    source: sourceRecords.map(({ path, sha256, gitBlob }) => ({ path, sha256, gitBlob })),
    loader,
    dependencies,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      esbuild: esbuild.version,
      binaryDigest,
    },
    build: { format: 'esm', target: 'es2022', compilerOptions, experimentalDecorators: true },
    operation,
    operationOptions,
    corpusManifest,
    additionalFiles,
    runtimeDependencies,
    workspaceScopes,
    ...(observeWorkingTree ? {} : { observeWorkingTree: false }),
    stubs: stubs.map(({ path, reason, kind, source }) => ({
      path,
      reason,
      kind,
      sha256: sha256(source),
    })),
  }
  const cacheKey = digestManifest(identity)
  const directory = path.resolve(cacheDir, cacheKey)
  await mkdir(directory, { recursive: true })
  for (const declared of runtimeDependencies) {
    const record = dependencies.find(item => item.name === declared.name)
    const link = path.join(directory, 'node_modules', declared.name)
    await mkdir(path.dirname(link), { recursive: true })
    try {
      await symlink(
        snapshotRoot(record.root),
        link,
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    if ((await realpath(link)) !== (await realpath(snapshotRoot(record.root))))
      throw new Error(`Corrupt runtime dependency link: ${declared.name}`)
  }
  let outputText = result.outputFiles[0].text
  for (const [url, resolution] of externalResolutions)
    outputText = outputText.replaceAll(
      url,
      pathToFileURL(path.join(snapshotRoot(resolution.root), resolution.relative)).href,
    )
  const output = Buffer.from(outputText)
  const bundleSha256 = sha256(output)
  const bundlePath = path.join(directory, 'oracle.mjs')
  let cacheHit = false
  try {
    const saved = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    const savedIdentity = Object.fromEntries(Object.keys(identity).map(key => [key, saved[key]]))
    if (
      saved.cacheKey !== cacheKey ||
      digestManifest(savedIdentity) !== cacheKey ||
      saved.bundleSha256 !== bundleSha256 ||
      sha256(await readFile(bundlePath)) !== bundleSha256
    )
      throw new Error('Corrupt oracle cache: identity or bundle digest mismatch')
    cacheHit = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const loaderSnapshots = loader.map((item, index) => ({
    ...item,
    snapshot: path.join(directory, 'loader', `${index}-${path.basename(item.path)}`),
  }))
  const evidence = {
    ...identity,
    cacheKey,
    sourceClosureDigest: digestManifest(identity.source),
    loaderDigest: digestManifest(loader),
    dependenciesDigest: digestManifest(dependencies),
    corpusDigest: digestManifest(corpusManifest),
    bundleSha256,
    sourceFiles: sourceRecords,
    loaderSnapshots,
    cacheHit,
    directory,
  }
  if (!cacheHit) {
    await ensureImmutableFile(bundlePath, output, bundleSha256, 'oracle bundle')
    const manifestPath = path.join(directory, 'manifest.json')
    const manifestBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`)
    await ensureImmutableFile(manifestPath, manifestBytes, sha256(manifestBytes), 'oracle manifest')
    await mkdir(path.join(directory, 'loader'), { recursive: true })
    for (const item of loaderSnapshots) {
      const bytes = await readFile(item.path)
      if (sha256(bytes) !== item.sha256) throw new Error(`Loader changed during load: ${item.path}`)
      await ensureImmutableFile(item.snapshot, bytes, item.sha256, 'loader snapshot')
    }
    // Snapshot every observed source/config/data file, including dirty mismatches, as pinned bytes.
    for (const record of inputs.values()) {
      const file = path.join(directory, 'source', record.path)
      await ensureImmutableFile(file, record.bytes, record.sha256, 'oracle source snapshot')
    }
  }
  for (const item of loaderSnapshots)
    if (sha256(await readFile(item.snapshot)) !== item.sha256)
      throw new Error(`Corrupt loader snapshot: ${item.path}`)
  return {
    module: await import(`${pathToFileURL(bundlePath).href}?sha256=${bundleSha256}`),
    evidence,
  }
}
