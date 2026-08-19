# `common/audio`

Audio-family reference extension. MP3 provides bounded ID3/MPEG structural detection; Ogg scans
pages and identifies Opus/Vorbis logical streams. Both publish metadata and an honest transport
snapshot. Neither claims PCM decode or playback ownership; those require the future media runtime
contract. The two entrypoints do not import each other.
