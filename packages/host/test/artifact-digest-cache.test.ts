import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  cachedArtifactDigest,
  flushArtifactDigestCache,
  useArtifactDigestCache,
} from '../src/node/artifact-digest-cache.js'

const work = await mkdtemp(join(tmpdir(), 'modkit-digest-cache-'))
afterAll(async () => {
  useArtifactDigestCache(undefined)
  await rm(work, { recursive: true, force: true })
})

describe('artifact digests kept between launches', () => {
  it('drops the record of a root that is no longer on disk and keeps the others', async () => {
    const present = join(work, 'present')
    const gone = join(work, 'gone')
    await mkdir(present, { recursive: true })
    const record = { fingerprint: 'f', artifactDigest: 'sha256:a', fileDigests: { 'x.json': 'sha256:b' } }
    const file = join(work, 'artifact-digests.v1.json')
    await writeFile(file, JSON.stringify({ version: 1, roots: { [present]: record, [gone]: record } }))
    useArtifactDigestCache(file)
    expect(cachedArtifactDigest(present, 'f')).toEqual(record)
    expect(cachedArtifactDigest(present, 'other')).toBeUndefined()
    expect(cachedArtifactDigest(gone, 'f')).toBeUndefined()
    flushArtifactDigestCache()
    const written = JSON.parse(await readFile(file, 'utf8')) as { roots: Record<string, unknown> }
    expect(Object.keys(written.roots)).toEqual([present])
  })
})
