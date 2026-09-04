/**
 * Load the legacy (MK2) DDS codec modules out of `references/modkitmk2` without building the MK2
 * monorepo, so they can serve as the oracle for the MK3 port.
 *
 * The legacy sources are TypeScript with relative `./x.js` specifiers and a handful of imports
 * from packages the comparison does not need. This copies each file into a temporary directory as
 * `.mts`, rewrites the relative specifiers to match, and replaces only the external imports —
 * never a line of the implementation. What each replacement stands in for is stated at the site.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//u, ''))
export const codingRoot = path.resolve(here, '..', '..')
export const legacySrc = path.join(
  codingRoot,
  'references/modkitmk2/extensions/common/images/codecs/dds/src',
)
export const legacyWasmPackage = path.join(
  codingRoot,
  'references/modkitmk2/node_modules/texture2ddecoder-wasm/dist/index.mjs',
)

/** `./types.js` → `./types.mts`, so the temporary copies resolve each other. */
function rewriteRelative(source) {
  return source.replaceAll(/(from\s+')(\.\/[A-Za-z0-9_-]+)\.js(')/gu, '$1$2.mts$3')
}

/**
 * `dds.ts` with its two non-decode imports replaced.
 *
 * `assertRgba8DecodeWithinLimit` is a size guard from `@modkitx/image-processing`; the local stand-in
 * uses the same 800 MB ceiling. `decode_bc6` / `decode_bc7` are the WASM entry points: with
 * `wasm: true` they are bound to the very npm package legacy imported (`texture2ddecoder-wasm`
 * from the MK2 checkout's own `node_modules`), and with `wasm: false` to stubs, for comparisons
 * that never reach a BPTC payload.
 */
async function ddsSource({ wasm }) {
  const original = await readFile(path.join(legacySrc, 'dds.ts'), 'utf8')
  const lines = original.split(/\r?\n/u)
  const bc7Line = lines.findIndex(line => line.includes('decode_bc6, decode_bc7'))
  const guardLine = lines.findIndex(line => line.includes('assertRgba8DecodeWithinLimit'))
  if (bc7Line < 0 || guardLine < 0 || guardLine > bc7Line) {
    throw new Error('legacy dds.ts import header did not match; refusing to guess')
  }
  const header = [
    'function assertRgba8DecodeWithinLimit(width, height) {',
    "  if (width * height * 4 > 800_000_000) throw new Error('decode limit')",
    '}',
    wasm
      ? `import { decode_bc6, decode_bc7 } from ${JSON.stringify(pathToFileURL(legacyWasmPackage).href)}`
      : 'const decode_bc6 = async () => null\nconst decode_bc7 = async () => null',
  ]
  return [...header, ...lines.slice(bc7Line + 1)].join('\n')
}

/** `helpers.ts` without the PNG and TGA conversions, which belong to other codecs' parity rows. */
async function helpersSource() {
  const original = await readFile(path.join(legacySrc, 'helpers.ts'), 'utf8')
  const trimmed = original
    .replace(/^import \{ decodePngRgba, encodePngRgba \} from '\.\/png\.js'$/mu, '')
    .replace(/^import \{ decodeTga \} from '\.\/tga\.js'$/mu, '')
    .replace(/^export function convertDdsToPng[\s\S]*?^\}$/mu, '')
    .replace(/^export function convertTgaToPng[\s\S]*?^\}$/mu, '')
    .replace(/^export function convertPngToDds[\s\S]*?^\}$/mu, '')
    .replace(/^export const ddsToPng = convertDdsToPng$/mu, '')
    .replace(/^export const pngToDds = convertPngToDds$/mu, '')
    .replace(/^export const tgaToPng = convertTgaToPng$/mu, '')
  return rewriteRelative(trimmed)
}

/**
 * `codec.ts` with its one runtime import replaced.
 *
 * `ModkitError` is MK2's error class from `@modkitx/core/errors`; the stand-in keeps the `code`,
 * `message` and `context` fields the comparison reads. Everything else in the file, including the
 * whole `readCompressedDds` body reached through `ddsCodec.readCompressed`, is untouched.
 */
async function codecSource() {
  const original = await readFile(path.join(legacySrc, 'codec.ts'), 'utf8')
  const stub = [
    'class ModkitError extends Error {',
    '  constructor(options) {',
    '    super(options.message)',
    '    this.code = options.code',
    '    this.context = options.context',
    '  }',
    '}',
  ].join('\n')
  return rewriteRelative(
    original.replace(/^import \{ ModkitError \} from '@modkitx\/core\/errors'$/mu, stub),
  )
}

let cache

/**
 * The legacy modules, as ES modules. `{ dds, helpers, ops }`.
 *
 * `wasm` selects whether the BC6H/BC7 entry points are real; it is honoured on the first call,
 * which is when the temporary copy is written.
 */
export async function loadLegacy({ wasm = false } = {}) {
  if (cache !== undefined) return cache
  const directory = mkdtempSync(path.join(tmpdir(), 'legacy-mk2-dds-'))
  const write = (name, source) => writeFileSync(path.join(directory, name), source)
  write('types.mts', 'export {}')
  write('dds.mts', rewriteRelative(await ddsSource({ wasm })))
  write('helpers.mts', await helpersSource())
  write('ops.mts', rewriteRelative(await readFile(path.join(legacySrc, 'ops.ts'), 'utf8')))
  write('metadata.mts', rewriteRelative(await readFile(path.join(legacySrc, 'metadata.ts'), 'utf8')))
  write('codec.mts', await codecSource())
  const load = name => import(pathToFileURL(path.join(directory, name)).href)
  cache = {
    directory,
    dds: await load('dds.mts'),
    helpers: await load('helpers.mts'),
    ops: await load('ops.mts'),
    metadata: await load('metadata.mts'),
    codec: await load('codec.mts'),
  }
  return cache
}
