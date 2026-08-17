import type { CodecPreviewOptions } from '../src/explorer/preview.js'

type AssertFalse<Value extends false> = Value

/** Compile gate: the UI preview API must not regain its direct codec-instantiation path. */
export type CodecPreviewHasNoFormats = AssertFalse<
  'formats' extends keyof CodecPreviewOptions ? true : false
>
export type CodecPreviewHasNoCreateCodec = AssertFalse<
  'createCodec' extends keyof CodecPreviewOptions ? true : false
>
export type CodecPreviewHasNoPrivateBudget = AssertFalse<
  'maximumBytes' extends keyof CodecPreviewOptions ? true : false
>

export const hostOwnedPreviewOptions = {
  stages: [],
  async openSession() {
    return undefined
  },
} satisfies CodecPreviewOptions
