# `common/audio`

Audio-family reference extension. MP3 provides bounded ID3/MPEG structural detection; Ogg scans
pages and identifies Opus/Vorbis logical streams. Both publish metadata and an honest transport
snapshot. Neither claims PCM decode or playback ownership; those require the future media runtime
contract. The two entrypoints do not import each other.

Editing (ADR-HOST-002). MP3 `edit.field` sets or replaces an ID3v2 text frame (`TIT2`, `TPE1`,
`TALB`, …), or creates an ID3v2.4 tag when the file has none: one byte-range replace of the tag
region, every other frame and the padding copied verbatim, no audio byte moved. Tags that are
unsynchronised or carry an extended header or a footer are refused with the reason instead of
rewritten. Ogg has no editing operation: a Vorbis comment lives inside a packet whose pages carry
their own CRC and segment table, so resizing it is a stream rewrite, not a byte range.

AAC, FLAC, M4A and WAV now ship in this product package as well. The older MP3, Ogg and separate
Opus staging routes were retired in favour of the richer native contributions already here: the
Ogg codec owns both Vorbis and Opus logical streams. Historical decisions remain in inert
`MIGRATION-NOTES-common-audio.json`.
