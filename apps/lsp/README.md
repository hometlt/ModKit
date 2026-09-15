# Modkit LSP

`@modkit/modkit-lsp` is the generic stdio adapter for installed Modkit language contributions.
It routes by inventory language ID, document kind, and extension without format-specific branches.

Start it with at least one absolute source root and one extension directory:

```text
modkit-lsp --root C:\workspace --extension C:\extensions\starcraft2
```

File documents are confined to configured roots. Host-owned `modkit-source:`,
`modkit-container:`, `content-source:`, and `untitled:` documents are accepted with the same
document and workspace byte limits. When supported by the client, the server dynamically
registers file watching for every configured root and refreshes the bounded open workspace after
a matching change.

The initialize result advertises `experimental.modkitLanguageCapabilities.version = 1`. Call
`modkit/languageCapabilities` with `{ "textDocument": { "uri": "..." } }` after opening a
document to obtain its exact version and activated feature names. Baseline analysis always exposes
`analyze`, `semantic-tokens`, `diagnostics`, and `document-symbols`; optional feature names appear
only when implemented by the selected provider.
