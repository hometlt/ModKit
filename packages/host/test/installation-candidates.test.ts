import { describe, expect, it } from 'vitest'
import { parse, resolve } from 'node:path'
import {
  collectInstallationCandidates,
  installationPathKey,
  normalizeInstallationPath,
} from '../src/node/installation-candidates.js'
import type { GameInstallationCandidate } from '@modkit/sdk/games'

describe('shared installation candidate collection', () => {
  it('merges a late duplicate after truncation while retaining first metadata and order', () => {
    const entries: GameInstallationCandidate[] = [
      { path: 'fixture/Game', origin: 'configured-path', displayName: 'Selected' },
      { path: 'fixture/Other', origin: 'default-directory', displayName: 'Other' },
      { path: 'fixture/Game', origin: 'steam', displayName: 'Steam', storeAppId: '2320' },
    ]
    const result = collectInstallationCandidates(entries, { maxCandidates: 1 })
    expect(result.truncated).toBe(true)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.displayName).toBe('Selected')
    expect(result.origins).toEqual([['configured-path', 'steam']])
    expect(result.storeAppIds).toEqual([['2320']])
    expect(Object.isFrozen(result.origins[0])).toBe(true)
  })
  it('preserves a filesystem root and uses platform-specific identity', () => {
    const root = parse(resolve('.')).root
    expect(normalizeInstallationPath(root)).toBe(root.replaceAll('\\', '/'))
    expect(installationPathKey('fixture/Game', 'win32')).toBe(
      installationPathKey('fixture/game', 'win32'),
    )
    expect(installationPathKey('fixture/Game', 'linux')).not.toBe(
      installationPathKey('fixture/game', 'linux'),
    )
  })
  it('stops collection on cancellation, including during lazy enumeration', () => {
    const controller = new AbortController()
    function* entries(): Iterable<GameInstallationCandidate> {
      yield { path: 'fixture/Game', origin: 'configured-path', displayName: 'Game' }
      controller.abort()
      yield { path: 'fixture/Other', origin: 'configured-path', displayName: 'Other' }
    }
    expect(() =>
      collectInstallationCandidates(entries(), { maxCandidates: 3, signal: controller.signal }),
    ).toThrow(/abort/iu)
    expect(() => collectInstallationCandidates([], { maxCandidates: 0 })).toThrow(RangeError)
  })
})
