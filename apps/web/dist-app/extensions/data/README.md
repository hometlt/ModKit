# `common/data`

One common data extension containing the CSV, TSV, INI, SYLK, TOML, XML and YAML codecs, their
syntax service contracts and their text writers (SYLK has no writer yet). Each codec remains an independent contribution with its
existing public ID, so it can be enabled, disabled and selected separately through Extension
Manager even though the implementations are distributed together.

SYLK (`.slk`, Warcraft III's unit, item and ability tables) is read by `parseSylk` in
`@modkit/codec-kit/text` and shown as a table whose first row is the header.

JSON and plain text stay native Modkit capabilities and are intentionally not duplicated here.
