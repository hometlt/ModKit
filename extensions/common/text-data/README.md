# `common/text-data`

External MK3 reference extension for JSON, JSONC, XML, YAML, TOML, INI, CSV and TSV. Syntax
providers are replaceable logical service contracts; codecs never import provider modules.

The package is intentionally outside `pnpm-workspace.yaml`. Its runtime parser dependencies stay
in this extension and never enter the `core/sdk/vfs/host` production closure.
