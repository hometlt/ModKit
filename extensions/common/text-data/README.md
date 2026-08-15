# `common/text-data`

External MK3 reference extension for JSON, JSONC, XML, YAML, TOML, INI, CSV and TSV. Every format
owns its codec, provider, definition and entry points under `src/formats/<format>/`. Syntax providers
are replaceable logical service contracts; codecs never import provider modules.

Only format-neutral lifecycle, text encoding, descriptor and data-source helpers live under
`src/shared/`. JSON/JSONC explicitly share the `src/families/json/` implementation and CSV/TSV
share `src/families/delimited/`; no format entry point imports any unrelated parser package.

The package is intentionally outside `pnpm-workspace.yaml`. Its runtime parser dependencies stay
in this extension and never enter the `core/sdk/vfs/host` production closure.
