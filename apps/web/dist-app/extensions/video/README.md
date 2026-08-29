# Video codecs

Portable, independently loadable MP4 and WebM inspection codecs. Each entrypoint parses bounded
container metadata and exposes `common.view/video-media-source` plus the generic tree, transport,
and byte-range contracts. Playback uses the platform viewer; native demuxers/decoders belong in
separate provider extensions and are not imported by this package.

No editing operation (ADR-HOST-002). Resizing an MP4 `ilst` atom grows `moov`, which shifts every
byte after it and invalidates the `stco`/`co64` chunk offsets into `mdat` unless `moov` is the last
box — a rewrite, not a byte range. Matroska/WebM stores absolute positions in `SeekHead`/`Cues` and
sizes its elements in variable-length integers, so a `Tags` resize invalidates them the same way.
Both wait for a writer provider that can rewrite those tables under evidence.

AVI, MPEG program streams, Ogg video and WMV now ship in this product package as well. The older
MP4 and WebM staging routes were retired in favour of the richer native contributions already
here. Historical decisions remain in inert `MIGRATION-NOTES-common-video.json`.
