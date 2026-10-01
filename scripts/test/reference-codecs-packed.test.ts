import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const temporaryRoot = mkdtempSync(join(tmpdir(), 'x3-reference-codecs-packed-'))
const tarballDirectory = join(temporaryRoot, 'tarballs')

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }))

function sh(command: string, args: string[], cwd: string) {
  const needsShim = process.platform === 'win32' && (command === 'pnpm' || command === 'npm')
  const result = needsShim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', command, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
        env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
      })
    : spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
        env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
      })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function pack(directory: string): string {
  mkdirSync(tarballDirectory, { recursive: true })
  const before = new Set(readdirSync(tarballDirectory))
  const result = sh('pnpm', ['pack', '--pack-destination', tarballDirectory], directory)
  expect(result.status, result.stderr).toBe(0)
  const created = readdirSync(tarballDirectory).find(
    file => file.endsWith('.tgz') && !before.has(file),
  )
  if (created === undefined) throw new Error(`pack produced no tarball for ${directory}`)
  return join(tarballDirectory, created)
}

function textFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...textFiles(path))
    else if (statSync(path).size <= 5_000_000) files.push(path)
  }
  return files
}

const formats = Object.freeze([
  {
    packageName: 'modkit-extension-archives',
    subpath: 'formats/zip/codec',
    format: 'zip',
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
  {
    packageName: 'modkit-extension-audio',
    subpath: 'formats/mp3/codec',
    format: 'mp3',
    bytes: [0xff, 0xfb, 0x90, 0x64],
  },
  {
    packageName: 'modkit-extension-audio',
    subpath: 'formats/ogg/codec',
    format: 'ogg',
    text: 'OggS',
  },
  {
    packageName: 'modkit-extension-images',
    subpath: 'formats/png/codec',
    format: 'png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    packageName: 'modkit-extension-images',
    subpath: 'formats/jpeg/codec',
    format: 'jpeg',
    bytes: [0xff, 0xd8, 0xff],
  },
  {
    packageName: 'modkit-extension-vector',
    subpath: 'formats/svg/codec',
    format: 'svg',
    text: '<svg/>',
  },
  {
    packageName: 'modkit-extension-models',
    subpath: 'formats/obj/codec',
    format: 'obj',
    text: 'v 0 0 0\nf 1 1 1\n',
  },
  {
    packageName: 'modkit-extension-models',
    subpath: 'formats/gltf/codec',
    format: 'gltf',
    text: '{"asset":{"version":"2.0"}}',
  },
  {
    packageName: 'modkit-extension-video',
    subpath: 'formats/mp4/codec',
    format: 'mp4',
    bytes: [0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d],
  },
  {
    packageName: 'modkit-extension-video',
    subpath: 'formats/webm/codec',
    format: 'webm',
    bytes: [0x1a, 0x45, 0xdf, 0xa3, 0x77, 0x65, 0x62, 0x6d],
  },
  {
    packageName: 'modkit-extension-documents',
    subpath: 'formats/markdown/codec',
    format: 'markdown',
    text: '# Packed\n',
  },
  {
    packageName: 'modkit-extension-documents',
    // relocated to the counted port path in slice 12-2, when the staging route was retired
    subpath: 'rtf/codec',
    format: 'rtf',
    text: '{\\rtf1\\ansi packed}',
  },
] as const)

describe('packed reference codec boundaries', () => {
  it(
    'installs all families from tarballs while keeping format code out of platform packages',
    { timeout: 360_000 },
    async () => {
      const platform = ['core', 'sdk', 'vfs', 'host'].map(name =>
        pack(join(repoRoot, 'packages', name)),
      )
      // the extensions' own workspace dependencies: codec-kit for all, uv and scene for models
      const support = ['codec-kit', 'uv', 'scene'].map(name =>
        pack(join(repoRoot, 'packages', name)),
      )
      const extensionDirectories = [
        join(repoRoot, 'extensions', 'archives'),
        join(repoRoot, 'extensions', 'audio'),
        join(repoRoot, 'extensions', 'images'),
        join(repoRoot, 'extensions', 'vector'),
        join(repoRoot, 'extensions', 'models'),
        join(repoRoot, 'extensions', 'video'),
        join(repoRoot, 'extensions', 'documents'),
      ]
      const extensions = extensionDirectories.map(pack)
      const consumer = join(temporaryRoot, 'consumer')
      mkdirSync(consumer, { recursive: true })
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'x3-reference-codecs-consumer', private: true, type: 'module' }),
      )
      const install = sh(
        'npm',
        [
          'install',
          '--no-audit',
          '--no-fund',
          '--install-links=false',
          ...platform,
          ...support,
          ...extensions,
        ],
        consumer,
      )
      expect(install.status, install.stderr).toBe(0)
      const externalRequire = createRequire(join(consumer, 'package.json'))
      const sdk = (await import(pathToFileURL(externalRequire.resolve('@modkit/sdk')).href)) as {
        revisionId(value: string): string
      }
      const encoder = new TextEncoder()
      for (const definition of formats) {
        const packageEntry = (await import(
          pathToFileURL(externalRequire.resolve(definition.packageName)).href
        )) as { contributionManifests: readonly string[] }
        expect(packageEntry.contributionManifests).toEqual(['./contributions/*.json'])
        const module = (await import(
          pathToFileURL(externalRequire.resolve(`${definition.packageName}/${definition.subpath}`))
            .href
        )) as {
          createCodec(context: unknown): {
            probe(request: unknown): Promise<{ codecId: string; confidence: number }>
          }
        }
        const bytes =
          'bytes' in definition ? new Uint8Array(definition.bytes) : encoder.encode(definition.text)
        const uri = `memory://packed/sample.${definition.format}`
        const codec = module.createCodec({
          budgets: {},
          diagnostics: { report: () => undefined },
          contracts: {},
        })
        const detection = await codec.probe({
          source: {
            kind: 'bytes',
            ref: { id: uri, uri },
            revision: sdk.revisionId(`content-hash.sha256:packed-${definition.format}`),
            size: BigInt(bytes.byteLength),
            async read(offset: bigint, length: number) {
              return bytes.slice(Number(offset), Number(offset) + length)
            },
            async *stream() {
              yield bytes
            },
          },
          plan: {
            kind: 'bytes',
            ranges: [{ from: 'start', length: 8192 }],
            maxBytes: 8192,
          },
        })
        expect(detection.confidence, definition.format).toBeGreaterThan(0.7)
      }

      const forbidden = [
        'archive-zip',
        'audio-mp3',
        'audio-ogg',
        'image-png',
        'image-jpeg',
        'vector-svg',
        'model-obj',
        'model-gltf',
        'video-mp4',
        'video-webm',
        'document-markdown',
        'document-rtf',
      ]
      for (const name of ['core', 'sdk', 'vfs', 'host']) {
        const combined = textFiles(join(consumer, 'node_modules', '@modkit', name))
          .map(file => readFileSync(file, 'utf8'))
          .join('\n')
        for (const needle of forbidden) expect(combined, `${name}: ${needle}`).not.toContain(needle)
      }
    },
  )
})
