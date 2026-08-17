# Video codecs

Portable, independently loadable MP4 and WebM inspection codecs. Each entrypoint parses bounded
container metadata and exposes `common.view/video-media-source` plus the generic tree, transport,
and byte-range contracts. Playback uses the platform viewer; native demuxers/decoders belong in
separate provider extensions and are not imported by this package.
