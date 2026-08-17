# `@modkitx-x3/codec-kit`

Optional runtime helper for small, portable inspection codecs. It owns only format-neutral
probe/open/session plumbing and generic tree/transport adapters. Format parsing stays inside the
extension that owns that format.

The package is deliberately outside the platform bootstrap dependency closure. Importing one
codec loads this helper and that codec's files; it never imports a catalog, another codec, or a
format-specific library.

## Minimal codec

```js
import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const definition = {
  id: 'org.example/codec-foo',
  format: { id: 'foo', label: 'Foo', mediaType: 'application/x-foo' },
  async detect(prefix) {
    const match = prefix[0] === 0x46 && prefix[1] === 0x4f && prefix[2] === 0x4f
    return { confidence: match ? 0.99 : 0.01, note: match ? 'foo-magic' : 'magic-mismatch' }
  },
  async inspect(bytes) {
    return {
      summary: { format: 'foo', bytes: bytes.byteLength },
      metadata: [{ id: 'foo', label: 'Foo', entries: [{ key: 'bytes', value: bytes.byteLength }] }],
      traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'file',
          label: 'Foo',
          children: [],
        }),
      },
    }
  },
}

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
```

The manifest remains the public claim and is validated independently. The definition above owns
only executable detection/inspection. Adding a sibling format means adding one entrypoint and one
manifest; neither the family package index nor an existing codec changes.
