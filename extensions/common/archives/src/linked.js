import { defineLinkedExtension } from '@modkitx-x3/host'

import sevenZipManifest from '../contributions/codec-7z.json' with { type: 'json' }
import brotliManifest from '../contributions/codec-brotli.json' with { type: 'json' }
import bzip2Manifest from '../contributions/codec-bzip2.json' with { type: 'json' }
import cabManifest from '../contributions/codec-cab.json' with { type: 'json' }
import dmgManifest from '../contributions/codec-dmg.json' with { type: 'json' }
import gzipManifest from '../contributions/codec-gzip.json' with { type: 'json' }
import isoManifest from '../contributions/codec-iso.json' with { type: 'json' }
import lzmaManifest from '../contributions/codec-lzma.json' with { type: 'json' }
import peManifest from '../contributions/codec-pe.json' with { type: 'json' }
import rarManifest from '../contributions/codec-rar.json' with { type: 'json' }
import tarManifest from '../contributions/codec-tar.json' with { type: 'json' }
import xzManifest from '../contributions/codec-xz.json' with { type: 'json' }
import zipManifest from '../contributions/codec-zip.json' with { type: 'json' }
import zstdManifest from '../contributions/codec-zstd.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as sevenZip from './7z/codec.js'
import * as brotli from './brotli/codec.js'
import * as bzip2 from './bzip2/codec.js'
import * as cab from './cab/codec.js'
import * as dmg from './dmg/codec.js'
import * as zip from './formats/zip/codec.js'
import * as gzip from './gzip/codec.js'
import * as iso from './iso/codec.js'
import * as lzma from './lzma/codec.js'
import * as pe from './pe/codec.js'
import * as rar from './rar/codec.js'
import * as tar from './tar/codec.js'
import * as xz from './xz/codec.js'
import * as zstd from './zstd/codec.js'

export const archives = defineLinkedExtension({
  source: 'linked:extensions/common/archives',
  packageJson,
  contributions: [
    { path: 'contributions/codec-7z.json', manifest: sevenZipManifest },
    { path: 'contributions/codec-brotli.json', manifest: brotliManifest },
    { path: 'contributions/codec-bzip2.json', manifest: bzip2Manifest },
    { path: 'contributions/codec-cab.json', manifest: cabManifest },
    { path: 'contributions/codec-dmg.json', manifest: dmgManifest },
    { path: 'contributions/codec-gzip.json', manifest: gzipManifest },
    { path: 'contributions/codec-iso.json', manifest: isoManifest },
    { path: 'contributions/codec-lzma.json', manifest: lzmaManifest },
    { path: 'contributions/codec-pe.json', manifest: peManifest },
    { path: 'contributions/codec-rar.json', manifest: rarManifest },
    { path: 'contributions/codec-tar.json', manifest: tarManifest },
    { path: 'contributions/codec-xz.json', manifest: xzManifest },
    { path: 'contributions/codec-zip.json', manifest: zipManifest },
    { path: 'contributions/codec-zstd.json', manifest: zstdManifest },
  ],
  modules: {
    './src/7z/codec.js': sevenZip,
    './src/brotli/codec.js': brotli,
    './src/bzip2/codec.js': bzip2,
    './src/cab/codec.js': cab,
    './src/dmg/codec.js': dmg,
    './src/formats/zip/codec.js': zip,
    './src/gzip/codec.js': gzip,
    './src/iso/codec.js': iso,
    './src/lzma/codec.js': lzma,
    './src/pe/codec.js': pe,
    './src/rar/codec.js': rar,
    './src/tar/codec.js': tar,
    './src/xz/codec.js': xz,
    './src/zstd/codec.js': zstd,
  },
})
