import { createTextCodec } from '../../../runtime/text.js'
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
