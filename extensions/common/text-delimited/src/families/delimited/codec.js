import { createTextCodec } from '@modkitx-x3/codec-kit/text'
import { detectDelimited } from './detect.js'

export function createDelimitedCodec(profile, context) {
  return createTextCodec(
    {
      ...profile,
      detect: (text, uri) => detectDelimited(profile.format, profile.delimiter, text, uri),
    },
    context,
  )
}
