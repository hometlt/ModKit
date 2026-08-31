# `common/documents`

Document-family reference extension. Markdown exposes source text and a structural outline. RTF
validates groups/control words and exposes portable flow metadata without mislabelling legacy ANSI
bytes as UTF-8. The two formats do not import each other. Rendering and sanitization remain
separate viewer concerns.

## The OpenDocument quartet

ODT, ODS, ODP and ODG are four separate contributions over one private package reader (`src/odf/`).
The reader is private on purpose: it is not exported from this package and nothing outside this
directory imports it, so a shared ODF reader never becomes a second archive platform.

Detection reads OpenDocument's own rule rather than the file name — the `mimetype` entry must be
first, stored uncompressed, and hold the exact media type — so a renamed package still opens and a
package belonging to another ODF format is refused by name.

Each codec publishes only what it actually recovered, through the generic contracts: ODT flow,
outline and text; ODS sheets, cells and formulas _as text, never evaluated_; ODP ordered slides
(`common.view/slide-deck-source@1`, a publisher-candidate contract — see ADR-DOC-001) plus a vector
preview of the first page; ODG pages, shapes, text and the same vector scene. The vector scene is a
derived structural preview built from the geometry that was parsed; ODF styles are not interpreted,
so it is deliberately unstyled and is not a rendering of the page. No writer is declared: preserving
repack and round-trip are unproved, so nothing here claims that an unknown package entry survives an
edit.

Codec provenance is explicit rather than inferred from its source directory. The MK2 port ratchet
reads `migration/codec-origins.json`, where MK3-authored codecs preserve their former paths while
all runtime modules use the flat `src/<codec>/codec.js` layout. ODT, ODS and ODP came from
`extensions/mk2/uncommon-documents`; Markdown, RTF and ODG were written here.
