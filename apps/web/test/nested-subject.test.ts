/**
 * An archive entry as a subject, in the browser composition (block 13 slice B).
 *
 * This is the last of the three products to get the route. The host has had `openNestedSubject`
 * since block 9; Electron reached it from its composition, VS Code reached it from its Explorer in
 * slice A, and this page reached it from nowhere — its archive stage extracted an entry's bytes
 * into a hex pane, which is a preview of a member and not the member. The registry row
 * `block9/archive-entry-as-subject` carried exactly that as its remaining `knownLoss`.
 *
 * What is proved here is the composition, not the DOM: the PWA's own subject services — codecs in
 * real module workers, the attested browser catalog, `browser-worker` as the target — open a member
 * of a ZIP as a subject of its own, and the container survives the child. The shell's affordance
 * that calls this route (`openNestedEntry`, and the button the archive stage draws for it) is
 * typed against the same signature; that a button exists is a weaker claim than this one and is
 * named as such rather than asserted here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { proves } from '@modkit/testkit'
import type { NamespaceEntrySource } from '@modkit/sdk'
import { rootSubject, serializeSubjectRef } from '@modkit/sdk/subjects'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import { openEmbedSession, type EmbedHost, type EmbedPreviewSession } from '../src/embed.js'
import { createWebLocalizer } from '../src/localization.js'
import { createWebSubjectServices } from '../src/subjects.js'
import { createWebPreviewFallback, createWebPreviewStages } from '../src/views.js'
import {
  diskOrigin,
  domGlobals,
  identity,
  nodeModuleMap,
  ORIGIN,
  probe,
  repositoryRoot,
  spawned,
} from './browser-harness.js'

const sampleZip = join(repositoryRoot, 'apps', 'web', 'public', 'samples', 'sample.zip')

afterEach(() => {
  spawned.splice(0)
})

describe('the browser opens a container member as a subject', () => {
  it('lists the ZIP, opens one entry through the host route, and outlives the child', async () => {
    const site = diskOrigin()
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog: WEB_EXTENSION_CATALOG,
      identity,
      probe,
      dom: domGlobals(site.fetch),
      moduleMap: nodeModuleMap,
    })

    const localizer = createWebLocalizer(['en'])
    const host: EmbedHost = {
      assetBase: ORIGIN,
      services,
      stages: createWebPreviewStages({ localizer, operationsFor: () => undefined }),
      fallback: createWebPreviewFallback(localizer),
      localizer,
      styles: { text: '' },
      operations: new Map(),
    }
    let child: EmbedPreviewSession | undefined
    const bytes = new Uint8Array(readFileSync(sampleZip))
    const archive = await openEmbedSession(
      host,
      { id: 'sample.zip', name: 'sample.zip', directory: false, size: bytes.byteLength },
      bytes,
      {
        token: 'content-hash.sha256:sample.zip',
        writable: false,
        async onNavigate(_target, opened) {
          child = opened
        },
      },
    )
    if (archive === undefined) throw new Error('sample.zip did not open through the embed host')

    /*
     * The entry id is the container's own and opaque by contract — the ZIP codec numbers them — so
     * it is read back from the listing rather than constructed. This is the same pair of calls the
     * shell's `openNestedEntry` makes.
     */
    const listing = await archive.dataSource('common.view/namespace-entry-source', 1)
    const page = await (listing.value as NamespaceEntrySource).list('', { limit: 64 })
    /*
     * The CSV rather than the first entry: the browser catalog is a subset of the lab's codecs, and
     * the point of this test is that a *claimed* member becomes a subject. Picking whichever entry
     * happens to be first would make the assertion depend on what the sample archive holds.
     */
    const entry = page.items.find(item => item.kind === 'file' && item.path.endsWith('.csv'))
    if (entry === undefined) throw new Error('the sample archive lists no CSV entry')

    const entryRef = await (listing.value as NamespaceEntrySource).openEntry(entry.id)
    const target = serializeSubjectRef(rootSubject({ id: entryRef.value.uri }))
    await entryRef.release()
    // The preview session owns its data source leases.
    const navigation = archive.subjectNavigation
    if (navigation === undefined) throw new Error('the embed session published no navigation port')
    await expect(navigation.open({ scope: navigation.scope, target })).resolves.toEqual({ state: 'opened' })
    if (child === undefined) throw new Error('the embed navigation owner received no child session')
    // A subject of its own: it has its own selection and its own exact serialized reference.
    const descriptor = child.opened.descriptor
    expect(descriptor.subjectUri).toBe(target)
    expect(descriptor.dataSources.length).toBeGreaterThan(0)

    // The child goes first and the container survives it — still listable, still the same archive.
    await child.dispose()
    const again = await archive.dataSource('common.view/namespace-entry-source', 1)
    await expect((again.value as NamespaceEntrySource).list('', { limit: 4 })).resolves.toBeTruthy()
    await archive.dispose()

    proves({
      capabilityId: 'block9/archive-entry-as-subject',
      operation: 'inspect',
      note: 'the PWA composition opens a ZIP member as its own subject through the host route',
    })
  }, 180_000)
})
