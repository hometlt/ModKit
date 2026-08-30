import { createTextCodec } from '@modkitx-x3/codec-kit/text'
import { detectJson } from './detect.js'

export function createJsonCodec(profile, context) {
  return createTextCodec(
    {
      ...profile,
      detect: (text, uri) => detectJson(profile.dialect, text, uri),
    },
    context,
  )
}
