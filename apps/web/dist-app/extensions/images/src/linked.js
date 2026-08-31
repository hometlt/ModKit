import { defineLinkedExtension } from '@modkit/host'

import aniManifest from '../contributions/codec-ani.json' with { type: 'json' }
import astcManifest from '../contributions/codec-astc.json' with { type: 'json' }
import avifManifest from '../contributions/codec-avif.json' with { type: 'json' }
import basisManifest from '../contributions/codec-basis.json' with { type: 'json' }
import bmpManifest from '../contributions/codec-bmp.json' with { type: 'json' }
import curManifest from '../contributions/codec-cur.json' with { type: 'json' }
import ddsManifest from '../contributions/codec-dds.json' with { type: 'json' }
import exrManifest from '../contributions/codec-exr.json' with { type: 'json' }
import gifManifest from '../contributions/codec-gif.json' with { type: 'json' }
import hdrManifest from '../contributions/codec-hdr.json' with { type: 'json' }
import icoManifest from '../contributions/codec-ico.json' with { type: 'json' }
import jpegManifest from '../contributions/codec-jpeg.json' with { type: 'json' }
import ktxManifest from '../contributions/codec-ktx.json' with { type: 'json' }
import ktx2Manifest from '../contributions/codec-ktx2.json' with { type: 'json' }
import palManifest from '../contributions/codec-pal.json' with { type: 'json' }
import pcxManifest from '../contributions/codec-pcx.json' with { type: 'json' }
import pkmManifest from '../contributions/codec-pkm.json' with { type: 'json' }
import pngManifest from '../contributions/codec-png.json' with { type: 'json' }
import pvrManifest from '../contributions/codec-pvr.json' with { type: 'json' }
import tgaManifest from '../contributions/codec-tga.json' with { type: 'json' }
import tiffManifest from '../contributions/codec-tiff.json' with { type: 'json' }
import webpManifest from '../contributions/codec-webp.json' with { type: 'json' }
import pngWriterManifest from '../contributions/writer-png.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as ani from './ani/codec.js'
import * as astc from './astc/codec.js'
import * as avif from './avif/codec.js'
import * as basis from './basis/codec.js'
import * as bmp from './bmp/codec.js'
import * as cur from './cur/codec.js'
import * as dds from './dds/codec.js'
import * as exr from './exr/codec.js'
import * as jpeg from './jpeg/codec.js'
import * as png from './png/codec.js'
import * as gif from './gif/codec.js'
import * as hdr from './hdr/codec.js'
import * as ico from './ico/codec.js'
import * as ktx from './ktx/codec.js'
import * as ktx2 from './ktx2/codec.js'
import * as pal from './pal/codec.js'
import * as pcx from './pcx/codec.js'
import * as pkm from './pkm/codec.js'
import * as pvr from './pvr/codec.js'
import * as tga from './tga/codec.js'
import * as tiff from './tiff/codec.js'
import * as webp from './webp/codec.js'
import * as pngWriter from './writers/png-encoder.js'

export const images = defineLinkedExtension({
  source: 'linked:extensions/images',
  packageJson,
  contributions: [
    { path: 'contributions/codec-ani.json', manifest: aniManifest },
    { path: 'contributions/codec-astc.json', manifest: astcManifest },
    { path: 'contributions/codec-avif.json', manifest: avifManifest },
    { path: 'contributions/codec-basis.json', manifest: basisManifest },
    { path: 'contributions/codec-bmp.json', manifest: bmpManifest },
    { path: 'contributions/codec-cur.json', manifest: curManifest },
    { path: 'contributions/codec-dds.json', manifest: ddsManifest },
    { path: 'contributions/codec-exr.json', manifest: exrManifest },
    { path: 'contributions/codec-gif.json', manifest: gifManifest },
    { path: 'contributions/codec-hdr.json', manifest: hdrManifest },
    { path: 'contributions/codec-ico.json', manifest: icoManifest },
    { path: 'contributions/codec-jpeg.json', manifest: jpegManifest },
    { path: 'contributions/codec-ktx.json', manifest: ktxManifest },
    { path: 'contributions/codec-ktx2.json', manifest: ktx2Manifest },
    { path: 'contributions/codec-pal.json', manifest: palManifest },
    { path: 'contributions/codec-pcx.json', manifest: pcxManifest },
    { path: 'contributions/codec-pkm.json', manifest: pkmManifest },
    { path: 'contributions/codec-png.json', manifest: pngManifest },
    { path: 'contributions/codec-pvr.json', manifest: pvrManifest },
    { path: 'contributions/codec-tga.json', manifest: tgaManifest },
    { path: 'contributions/codec-tiff.json', manifest: tiffManifest },
    { path: 'contributions/codec-webp.json', manifest: webpManifest },
    { path: 'contributions/writer-png.json', manifest: pngWriterManifest },
  ],
  modules: {
    './src/ani/codec.js': ani,
    './src/astc/codec.js': astc,
    './src/avif/codec.js': avif,
    './src/basis/codec.js': basis,
    './src/bmp/codec.js': bmp,
    './src/cur/codec.js': cur,
    './src/dds/codec.js': dds,
    './src/exr/codec.js': exr,
    './src/jpeg/codec.js': jpeg,
    './src/png/codec.js': png,
    './src/gif/codec.js': gif,
    './src/hdr/codec.js': hdr,
    './src/ico/codec.js': ico,
    './src/ktx/codec.js': ktx,
    './src/ktx2/codec.js': ktx2,
    './src/pal/codec.js': pal,
    './src/pcx/codec.js': pcx,
    './src/pkm/codec.js': pkm,
    './src/pvr/codec.js': pvr,
    './src/tga/codec.js': tga,
    './src/tiff/codec.js': tiff,
    './src/webp/codec.js': webp,
    './src/writers/png-encoder.js': pngWriter,
  },
})
