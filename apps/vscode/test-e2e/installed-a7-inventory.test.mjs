import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readInstalledA7Inventory, assertInstalledA7 } from './installed-a7-inventory.mjs'

const inventory = {
  roots: ['modkit/a', 'modkit/b'],
  contributions: ['modkit/a#one', 'modkit/b#two'],
}
const receipt = () => ({
  expectedRoots: [...inventory.roots],
  loadedRoots: [...inventory.roots].reverse(),
  expectedContributions: [...inventory.contributions],
  loadedContributions: [...inventory.contributions],
  missingRoots: [],
  unexpectedRoots: [],
  missingContributions: [],
  unexpectedContributions: [],
  loadErrors: [],
  verdict: 'pass',
})
test('exact installed identities replace historical counts without accepting missing/extra/duplicate/equal-count substitutions', () => {
  assertInstalledA7(receipt(), inventory)
  for (const field of [
    'expectedRoots',
    'loadedRoots',
    'expectedContributions',
    'loadedContributions',
  ]) {
    for (const change of [
      items => ['wrong', ...items.slice(1)],
      items => items.slice(1),
      items => [...items, 'extra'],
      items => [items[0], items[0]],
    ]) {
      const bad = receipt()
      bad[field] = change(bad[field])
      assert.throws(() => assertInstalledA7(bad, inventory))
    }
  }
  for (const field of [
    'missingRoots',
    'unexpectedRoots',
    'missingContributions',
    'unexpectedContributions',
    'loadErrors',
  ])
    assert.throws(() => assertInstalledA7({ ...receipt(), [field]: ['failure'] }, inventory))
})
test(
  'real installed artifact inventory self-check',
  { skip: !process.env.MODKIT_A7_INSTALLED_ROOT },
  async () => {
    const actual = await readInstalledA7Inventory(process.env.MODKIT_A7_INSTALLED_ROOT)
    assert.ok(actual.roots.length > 0 && actual.contributions.length > 0)
    assert.match(actual.authority.sha256, /^sha256:[0-9a-f]{64}$/)
    assertInstalledA7(
      {
        ...receipt(),
        expectedRoots: actual.roots,
        loadedRoots: actual.roots,
        expectedContributions: actual.contributions,
        loadedContributions: actual.contributions,
      },
      actual,
    )
  },
)
