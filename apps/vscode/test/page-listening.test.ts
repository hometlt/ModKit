import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeJsonValue, encodeJsonValue } from '@modkit/host/execution'
import { describe, expect, it } from 'vitest'

import type { WebviewChannel } from '../src/bridge.js'
import { createVsCodeSubjectHost } from '../src/host.js'

const commonExtensions = join(import.meta.dirname, '..', '..', '..', 'extensions')

/*
 * v87: «Entity Card…» revealed a package panel restored unseen and named the entity at once; the
 * page loaded only when shown, the request went before its bridge listened, and the panel showed
 * the package instead of the card.
 */
describe('what the host asks of a page that does not listen yet', () => {
  it('is held until the page listens, then sent', async () => {
    const posted: unknown[] = []
    let deliver: (message: unknown) => void = () => undefined
    const channel: WebviewChannel = {
      post: message => void posted.push(message),
      onMessage: handler => {
        deliver = handler
        return () => undefined
      },
    }
    const host = await createVsCodeSubjectHost({ catalogCandidates: [commonExtensions] })
    const served = host.serve({
      channel,
      session: 'page-listening-test',
      roots: () => [mkdtempSync(join(tmpdir(), 'modkit-vscode-listening-'))],
    })
    const navigations = () =>
      posted
        .filter(message => typeof message !== 'string')
        .map(message => decodeJsonValue(message as never) as { event?: { op?: string } })
        .filter(envelope => envelope.event?.op === 'navigate-subject')
    try {
      served.navigate('modkit-subject://blizzard%2Fsc2-data/Unit/SCV', 'card')
      expect(navigations()).toHaveLength(0)
      deliver(encodeJsonValue({ modkit: 1, kind: 'event', event: { op: 'page-listening' } }))
      expect(navigations()).toHaveLength(1)
      // a page that listens is asked at once
      served.navigate('modkit-subject://blizzard%2Fsc2-data/Unit/Marine', 'card')
      expect(navigations()).toHaveLength(2)
    } finally {
      await served.close('test over')
    }
  }, 120_000)
})
