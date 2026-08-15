import { detectDelimited } from '../../families/delimited/detect.js'
import { createTextCodec } from '../../shared/codec-runtime.js'
import { definition } from './definition.js'

export const abiVersion = 1
export const createCodec = context =>
  createTextCodec(
    {
      ...definition,
      detect: (text, uri) => detectDelimited('csv', definition.delimiter, text, uri),
    },
    context,
  )
