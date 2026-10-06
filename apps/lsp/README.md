# Modkit LSP

`@modkit/modkit-lsp` is the generic stdio adapter for installed Modkit language contributions.
It routes by inventory language ID, document kind, and extension without format-specific branches.

Start it with at least one absolute source root and one extension directory:

```text
modkit-lsp --root C:\workspace --extension C:\extensions\starcraft2
```

Resolved Data of loaded mods stays in memory up to `--resolved-data-memory-mib` (default 512).
With `--resolved-data-cache <directory>` (an index cache directory, such as the one VS Code or the
CLI keeps), complete analyses of the packages the Data provider names — StarCraft II:
`cachedMods`, Liberty and Void by default — are kept there across runs, within
`--resolved-data-cache-mib` (default 1024), and read back while nothing they read has changed.

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
