#!/usr/bin/env node
import { copyCli } from './lib/mk2-copy.mjs'
try {
  await copyCli('copy')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
