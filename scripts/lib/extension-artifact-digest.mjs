import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Exact file set used by `packages/host/src/node/loader.ts#listArtifactFiles`.
 *
 * This build-side copy exists because catalog checks run before TypeScript emits `host/dist` on a
 * clean checkout. Keep its small framing regression compared with the public loader.
 */
export function listExtensionArtifactFiles(root) {
  const out = []
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return out
}

/**
 * The host's canonical extension artifact identity: length-framed UTF-8 path plus length-framed
 * bytes, in stable path order. A rename and ambiguous concatenations therefore cannot collide.
 */
export function extensionArtifactDigest(root) {
  const hash = createHash('sha256')
  for (const path of listExtensionArtifactFiles(root)) {
    const pathBytes = Buffer.from(path, 'utf8')
    const contents = readFileSync(join(root, path))
    hash.update(Buffer.from(String(pathBytes.byteLength)))
    hash.update(Buffer.from([0]))
    hash.update(pathBytes)
    hash.update(Buffer.from([0]))
    hash.update(Buffer.from(String(contents.byteLength)))
    hash.update(Buffer.from([0]))
    hash.update(contents)
  }
  return `sha256:${hash.digest('hex')}`
}
