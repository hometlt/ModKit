import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  createA7AcceptanceReceipt,
  createModkitAcceptanceReceipt,
  exposeModkitAcceptance,
  withSubjectAcceptance,
  type BundledAcceptanceRoot,
} from '../src/acceptance.js'
import type { BundledCatalogRoot } from '../src/extension-roots.js'
import { createVsCodeSubjectHost } from '../src/host.js'

const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
type GeneratedBundledRoot = BundledAcceptanceRoot & BundledCatalogRoot

const catalog: readonly BundledAcceptanceRoot[] = Object.freeze([
  {
    name: 'one',
    directory: 'one',
    coordinate: 'org.example/one',
    contributions: ['org.example/shared', 'org.example/one-codec'],
  },
  {
    name: 'two',
    directory: 'two',
    coordinate: 'org.example/two',
    contributions: ['org.example/shared'],
  },
])

describe('VS Code installed-product acceptance receipt', () => {
  it('reports the generated Common catalog as exact 8 roots / 87 contributions', async () => {
    const generated = JSON.parse(
      readFileSync(
        join(repositoryRoot, 'apps', 'vscode', 'generated', 'bundled-catalog.json'),
        'utf8',
      ),
    ) as { readonly roots: readonly GeneratedBundledRoot[] }
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [join(repositoryRoot, 'extensions')],
      bundledCatalog: generated.roots,
    })
    const receipt = createA7AcceptanceReceipt(generated.roots, {
      roots: host.extensions.bundled,
      contributions: host.contributions,
      loadErrors: host.bundledLoadErrors,
    })

    expect(receipt.expectedRoots).toHaveLength(8)
    expect(receipt.loadedRoots).toHaveLength(8)
    expect(receipt.expectedContributions).toHaveLength(87)
    expect(receipt.loadedContributions).toHaveLength(87)
    expect(receipt).toMatchObject({
      missingRoots: [],
      unexpectedRoots: [],
      missingContributions: [],
      unexpectedContributions: [],
      loadErrors: [],
      verdict: 'pass',
    })
  }, 120_000)

  it('compares owner-qualified roots and contributions without hiding cross-root id collisions', () => {
    const receipt = createA7AcceptanceReceipt(catalog, {
      roots: ['org.example/two', 'org.example/one'],
      contributions: [
        {
          id: 'org.example/shared',
          extension: 'org.example/two',
          origin: 'bundled',
          path: 'contributions/shared.json',
        },
        {
          id: 'org.example/one-codec',
          extension: 'org.example/one',
          origin: 'bundled',
          path: 'contributions/one.json',
        },
        {
          id: 'org.example/shared',
          extension: 'org.example/one',
          origin: 'bundled',
          path: 'contributions/shared.json',
        },
        {
          id: 'org.example/not-bundled',
          extension: 'org.example/local',
          origin: 'installed',
          path: 'C:\\private\\local.json',
        },
      ],
      loadErrors: [],
    })

    expect(receipt.expectedContributions).toEqual([
      'org.example/one#org.example/one-codec',
      'org.example/one#org.example/shared',
      'org.example/two#org.example/shared',
    ])
    expect(receipt.loadedContributions).toEqual(receipt.expectedContributions)
    expect(receipt).toMatchObject({
      expectedRoots: ['org.example/one', 'org.example/two'],
      loadedRoots: ['org.example/one', 'org.example/two'],
      missingRoots: [],
      unexpectedRoots: [],
      missingContributions: [],
      unexpectedContributions: [],
      loadErrors: [],
      verdict: 'pass',
    })
  })

  it('fails on a missing root and redacts loader paths from machine-readable errors', () => {
    const receipt = createA7AcceptanceReceipt(catalog, {
      roots: ['org.example/one'],
      contributions: [
        {
          id: 'org.example/shared',
          extension: 'org.example/one',
          origin: 'bundled',
          path: 'contributions/shared.json',
        },
        {
          id: 'org.example/one-codec',
          extension: 'org.example/one',
          origin: 'bundled',
          path: 'contributions/one.json',
        },
      ],
      loadErrors: [
        {
          root: 'C:\\Users\\owner\\installed-extension\\two',
          code: 'x3.host/extension-not-an-extension',
          message: 'C:\\Users\\owner\\installed-extension\\two is invalid',
        },
      ],
    })

    expect(receipt.missingRoots).toEqual(['org.example/two'])
    expect(receipt.missingContributions).toEqual(['org.example/two#org.example/shared'])
    expect(receipt.loadErrors).toEqual([
      {
        root: 'org.example/two',
        code: 'x3.host/extension-not-an-extension',
        message: 'bundled root «org.example/two» did not load completely',
      },
    ])
    expect(receipt.verdict).toBe('fail')
    expect(JSON.stringify(receipt)).not.toContain('Users')
    expect(JSON.stringify(receipt)).not.toContain('installed-extension')
  })

  it('publishes a frozen subject receipt without its absolute path or URI', () => {
    const initial = createModkitAcceptanceReceipt(
      createA7AcceptanceReceipt([], { roots: [], contributions: [], loadErrors: [] }),
    )
    const opened = withSubjectAcceptance(initial, {
      selected: {
        extensionId: 'modkit/images',
        contributionId: 'modkit/dds',
        variantId: 'default',
        confidence: 1,
      },
      selectedRoute: [
        {
          formatId: 'zip',
          extensionId: 'modkit/archives',
          contributionId: 'modkit/archive-zip',
        },
        {
          formatId: 'dds',
          extensionId: 'modkit/images',
          contributionId: 'modkit/dds',
        },
      ],
      descriptor: {
        subjectUri: 'file:///C:/private/fixture.dds',
        identity: {
          codecId: 'modkit/dds',
          formatId: 'dds',
          sourceUri: 'file:///C:/private/fixture.dds',
          nested: { path: 'C:\\private\\fixture.dds' },
        },
      },
    })
    const target = {}
    exposeModkitAcceptance(target, initial)
    exposeModkitAcceptance(target, opened)

    expect(target).toHaveProperty('__MODKIT_ACCEPTANCE__', opened)
    expect(Object.getOwnPropertyDescriptor(target, '__MODKIT_ACCEPTANCE__')).toMatchObject({
      configurable: false,
      enumerable: false,
      set: undefined,
    })
    expect(Object.isFrozen(opened)).toBe(true)
    expect(Object.isFrozen(opened.subject?.selected)).toBe(true)
    expect(Object.isFrozen(opened.subject?.selectedRoute)).toBe(true)
    expect(Object.isFrozen(opened.subject?.selectedRoute?.[0])).toBe(true)
    expect(opened.subject).toMatchObject({
      selected: { contributionId: 'modkit/dds', variantId: 'default', confidence: 1 },
      selectedRoute: [
        {
          formatId: 'zip',
          extensionId: 'modkit/archives',
          contributionId: 'modkit/archive-zip',
        },
        {
          formatId: 'dds',
          extensionId: 'modkit/images',
          contributionId: 'modkit/dds',
        },
      ],
      descriptor: {
        identity: {
          codecId: 'modkit/dds',
          formatId: 'dds',
          sourceUri: '<redacted:absolute-location>',
          nested: { path: '<redacted:absolute-location>' },
        },
      },
    })
    const serialized = JSON.stringify(opened)
    expect(serialized).not.toContain('fixture.dds')
    expect(serialized).not.toContain('subjectUri')
  })

  it('redacts absolute-looking values even when a hostile route reaches the receipt boundary', () => {
    const initial = createModkitAcceptanceReceipt(
      createA7AcceptanceReceipt([], { roots: [], contributions: [], loadErrors: [] }),
    )
    const opened = withSubjectAcceptance(initial, {
      selected: { contributionId: 'modkit/dds', variantId: 'default', confidence: 1 },
      selectedRoute: [
        {
          formatId: 'C:\\private\\format',
          extensionId: 'file:///C:/private/extension',
          contributionId: '/private/contribution',
        },
      ],
      descriptor: { identity: { formatId: 'dds' } },
    })

    expect(opened.subject?.selectedRoute).toEqual([
      {
        formatId: '<redacted:absolute-location>',
        extensionId: '<redacted:absolute-location>',
        contributionId: '<redacted:absolute-location>',
      },
    ])
    expect(JSON.stringify(opened)).not.toContain('private')
  })

  it('turns a generated catalog missing root into an A7 load error source', async () => {
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [join(repositoryRoot, 'extensions')],
      bundledCatalog: [
        { name: 'images', directory: 'images', declared: true },
        { name: 'not-shipped', directory: 'not-shipped', declared: true },
      ],
    })

    expect(host.extensions.bundled).toContain('modkit/images')
    expect(host.bundledLoadErrors).toEqual([
      expect.objectContaining({
        code: 'x3.app/vscode-bundled-catalog-incomplete',
        message: expect.stringContaining('not-shipped'),
      }),
    ])
  }, 120_000)
})
