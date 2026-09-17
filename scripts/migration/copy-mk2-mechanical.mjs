#!/usr/bin/env node
// Stage H sibling of copy-mk2.mjs: mechanical (non-SC2) Blizzard/publisher copies.
// copy-mk2.mjs itself is left untouched — it stays the SC2 receipt-parity entry point.
import { mechanicalCopyCli } from './lib/mk2-copy.mjs'
try {
  await mechanicalCopyCli('copy')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
