import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '..')
const policy = JSON.parse(readFileSync(join(appRoot, 'format-smoke-policy.v1.json'), 'utf8'))
const generated = JSON.parse(
  readFileSync(join(appRoot, 'generated', 'format-smoke.v1.json'), 'utf8'),
)
const requiredCases = [
  ['image-dds', 'images', ['dds']],
  ['image-png', 'images', ['png']],
  ['image-tga', 'images', ['tga']],
  ['image-jpeg', 'images', ['jpeg']],
  ['document-odt', 'document-data', ['odt']],
  ['data-xml', 'document-data', ['xml']],
  ['archive-zip', 'archives', ['zip']],
  ['archive-warzone-wz', 'archives', ['warzone-wz']],
  ['archive-mpq', 'archives', ['sc2-map']],
  ['casc-dds', 'archives-images', ['casc', 'dds']],
  ['audio-wav', 'audio', ['casc', 'wav']],
  ['audio-ogg', 'audio', ['casc', 'ogg']],
  ['model-m3', 'models', ['casc', 'm3']],
  ['model-warzone-pie', 'models', ['warzone-wz', 'warzone-pie']],
] as const

describe('generated installed format-family smoke', () => {
  it('derives every ratified format route from the shipped inventories', () => {
    expect(generated.kind).toBe('x3.ga-recovery/format-family-smoke')
    expect(generated.schemaVersion).toBe(1)
    expect(generated.cases.map((entry: { id: string }) => entry.id)).toEqual(
      policy.cases.map((entry: { id: string }) => entry.id),
    )
    expect(
      policy.cases.map((entry: { id: string; family: string; formatIds: string[] }) => [
        entry.id,
        entry.family,
        entry.formatIds,
      ]),
    ).toEqual(requiredCases)
    for (const [index, entry] of generated.cases.entries()) {
      expect(entry.formats).toEqual(policy.cases[index].formatIds)
      expect(entry.route.map((step: { formatId: string }) => step.formatId)).toEqual(entry.formats)
      expect(entry.route.every((step: { contributionId: string }) => step.contributionId)).toBe(
        true,
      )
      expect(entry.route.every((step: { extensionId: string }) => step.extensionId)).toBe(true)
      expect(entry.runtime.vscode).toBe('open')
      expect(entry.runtime.electron).toBe('open')
      if (entry.runtime.pwa.kind === 'browser-subset') {
        expect(entry.runtime.browserWorkerVariantsPresent).toBe(true)
      } else {
        expect(entry.runtime.pwa).toEqual({
          kind: 'host-facility-refusal',
          code: 'x3.host/facility-unavailable',
          facility: 'filesystem.read-random',
        })
      }
    }
  })

  it('requires real corpora for all 14 families without an exclusion', () => {
    expect(generated.namedExclusions).toEqual([])
    expect(
      generated.cases.filter(
        (entry: { corpus: { kind: string } }) => entry.corpus.kind === 'named-exclusion',
      ),
    ).toHaveLength(0)
    expect(
      generated.cases.find((entry: { id: string }) => entry.id === 'document-odt').corpus,
    ).toEqual({
      kind: 'workspace-reference',
      path: 'downloads/file-examples/documents/file-sample_100kB.odt',
      bytes: 116076,
      sha256: 'ec78ee3b75df5da1556b0a3e1c3cf81c05f01dcacee057190786545e851f3835',
    })
  })

  it('keeps the installed release at exact 10 Common plus 9 external roots', () => {
    // Ten since the built-in Lua extension shipped (d7146e77).
    expect(generated.generatedFrom.bundledCatalog.roots).toHaveLength(10)
    expect(generated.generatedFrom.bundledCatalog.provenance).toBe(
      'checkout-physical-roots-verified-by-host-artifact-digest',
    )
    expect(
      generated.generatedFrom.bundledCatalog.roots.every(
        (root: { coordinate: string; digest: string }) =>
          root.coordinate.startsWith('modkit/') && /^sha256:[0-9a-f]{64}$/.test(root.digest),
      ),
    ).toBe(true)
    expect(generated.generatedFrom.offlineRelease.roots).toHaveLength(9)
    expect(generated.generatedFrom.offlineRelease.packageIds).toEqual([
      'blizzard/starcraft2-suite',
      'wz2100project/warzone-2100',
    ])
    expect(generated.generatedFrom.offlineRelease.catalogSignature).toMatchObject({
      algorithm: 'Ed25519',
      keyId: 'modkit.ga-wave1b-2026-09-01',
      verified: true,
    })
  })
})
