# `common/plain-text`

The final home of the plain-text route, relocated out of `extensions/mk2/uncommon-documents` by
block 11 slice 11A. It carries exactly two contributions and they do different jobs.

**`org.modkitx/txt` — the codec, read-only.** It decodes a bounded UTF-8 or UTF-16 source, keeps the
byte-order mark as provenance rather than as content, refuses binary, and publishes the text, the
paragraph outline and the raw bytes. It never writes the source: `view.inspect`, `asset.validate`,
`asset.search` and `export.raw` are the whole surface.

The MK2 port decoded strict UTF-8 only and rejected everything else, so a UTF-16 note was simply not
a document. Here UTF-16LE and UTF-16BE with a byte-order mark decode, and the encoding, the mark and
the newline style are reported as `content.text` parameters. The lazy `common.view/text-data-source`
is published for UTF-8 only, because it indexes lines over the source bytes and that index is not
true for UTF-16 — the outline and the byte source still work, and nothing pretends otherwise.

Binary rejection is evidence, not a guess: a NUL byte, an undecodable prefix, or a control-character
ratio above two percent means this is not plain text, and the probe says so instead of returning a
document full of replacement characters.

Generic text yields to a game that owns the path. A `.txt` inside a StarCraft II container or under
`LocalizedData/` belongs to the localisation codec that understands it, so the plain-text probe drops
to a decisive minimum there rather than racing a codec with real format evidence.

**`org.modkitx/plain-text-writer` — the writer, separate.** Legacy plain text could be edited, and
that capability comes back as its own `common.edit/writer@1` contribution rather than as a mutating
codec. The universal text editor authors a `ChangeSet`, the writer states what it can carry and
refuses the rest with a diagnostic, and the host coordinator commits under `write-source`. A range
edit touches only the range it names, so the claim is `byte-identical` with `preservesUnknownData`.
