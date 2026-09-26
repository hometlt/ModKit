/**
 * One frame of an encoded video as pixels, offered by a desktop host to codecs through
 * `ContributionContext.videoFrames`. A video codec parses its container and publishes
 * `common.view/video-media-source`; its `readFrame` asks this decoder, so container parsing and frame
 * decoding keep one owner each. The implementation lives in the host (`@modkit/host/node`, over an
 * installed ffmpeg); a host without one offers none and codecs publish `frameAccess: false`.
 */

import type { VideoFrame } from './asset-capabilities/media-data-sources.js'

export interface VideoFrameDecodeRequest {
  /** The whole encoded file, as `encoded()` of the media source hands it out. */
  readonly bytes: Uint8Array
  /** Container media type (`video/mp4`, `video/webm`, `video/vnd.radgamettools.bink`, …), a hint. */
  readonly mediaType: string
  readonly timestampMs: number
  /** Upper bound of the decoded RGBA8 pixels; a larger frame is refused, not scaled. */
  readonly maxBytes: number
  readonly signal?: AbortSignal
}

export interface VideoFrameDecoder {
  decodeFrame(request: VideoFrameDecodeRequest): Promise<VideoFrame>
}
