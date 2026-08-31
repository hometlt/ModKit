# `common/data`

One common data extension containing the CSV, TSV, INI, TOML, XML and YAML codecs, their syntax
service contracts and their text writers. Each codec remains an independent contribution with its
existing public ID, so it can be enabled, disabled and selected separately through Extension
Manager even though the implementations are distributed together.

JSON and plain text stay native Modkit capabilities and are intentionally not duplicated here.
