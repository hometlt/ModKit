/*
 * Modkit shim over Microsoft jxrlib (BSD-3-Clause, see LICENSE): decode one JPEG XR file held in
 * memory into a caller buffer. Unlike the upstream wasm_api.c it decodes the alpha plane, planar
 * or interleaved (jxrlib decodes alpha only when uAlphaMode is 2), and owns the memory stream it
 * opens. Explicit raw mode returns 1..3 biased 8-bit codestream components without ICC;
 * explicit independent-component HDP mode admits only the proven spatial/subversion-1,
 * overlap-1, no-alpha/no-flexbits profile. Standard decoding is unchanged by default.
 * No encoder entry points; no file system; no stdio.
 */
#include <stdlib.h>
#include <emscripten.h>
#include "JXRGlue.h"

typedef struct {
    struct WMPStream *stream;
    PKImageDecode *decode;
    int raw;
    int channels;
} MkJxr;

/* Close a handle from mk_jxr_open, releasing the decoder and then its memory stream. */
EMSCRIPTEN_KEEPALIVE
void mk_jxr_close(MkJxr *handle)
{
    if (!handle) return;
    if (handle->decode) handle->decode->Release(&handle->decode);
    if (handle->stream) handle->stream->Close(&handle->stream);
    free(handle);
}

/* Open a JPEG XR file (container + codestream) of `bytes` bytes at `buffer`; NULL when invalid. */
EMSCRIPTEN_KEEPALIVE
MkJxr *mk_jxr_open(void *buffer, size_t bytes, int mode)
{
    MkJxr *handle = (MkJxr *)calloc(1, sizeof(MkJxr));
    if (!handle) return NULL;
    if (CreateWS_Memory(&handle->stream, buffer, bytes) ||
        PKImageDecode_Create_WMP(&handle->decode) ||
        handle->decode->Initialize(handle->decode, handle->stream)) {
        mk_jxr_close(handle);
        return NULL;
    }
    /* jxrlib's memory stream clamps reads at its end, so a truncated file would decode silently:
       refuse a container whose image or alpha plane runs past the bytes it was given */
    const unsigned long long image = (unsigned long long)handle->decode->WMP.wmiDEMisc.uImageOffset +
        handle->decode->WMP.wmiDEMisc.uImageByteCount;
    const unsigned long long alpha = (unsigned long long)handle->decode->WMP.wmiDEMisc.uAlphaOffset +
        handle->decode->WMP.wmiDEMisc.uAlphaByteCount;
    if (image > bytes || alpha > bytes) {
        mk_jxr_close(handle);
        return NULL;
    }
    PKPixelInfo info;
    GUID guid;
    if (handle->decode->GetPixelFormat(handle->decode, &guid)) {
        mk_jxr_close(handle);
        return NULL;
    }
    info.pGUIDPixFmt = &guid;
    const int known = PixelFormatLookup(&info, LOOKUP_FORWARD) == WMP_errSuccess;
    if (mode & ~3) {
        mk_jxr_close(handle);
        return NULL;
    }
    if (mode & 1) {
        const size_t offset = handle->decode->WMP.wmiDEMisc.uImageOffset;
        const U8 *header = (const U8 *)buffer + offset;
        const CWMIStrCodecParam *scp = &handle->decode->WMP.wmiSCP;
        if (!(mode & 2) || offset > bytes || bytes - offset < 16 ||
            header[8] != 0x11 || header[9] != 1 || header[10] != 0xc0 ||
            scp->olOverlap != OL_ONE || scp->bfBitstreamFormat != SPATIAL ||
            scp->sbSubband != SB_NO_FLEXBITS || scp->cNumOfSliceMinus1V || scp->cNumOfSliceMinus1H ||
            !(scp->cfColorFormat == Y_ONLY || scp->cfColorFormat == YUV_444 || scp->cfColorFormat == NCOMPONENT)) {
            mk_jxr_close(handle);
            return NULL;
        }
        handle->decode->WMP.wmiSCP.bModkitHdp = TRUE;
    }
    if (mode & 2) {
        const int channels = (int)handle->decode->WMP.wmiSCP.cChannel;
        if (!known || info.bdBitDepth != BD_8 || channels < 1 || channels > 3 ||
            (info.grBit & (PK_pixfmtHasAlpha | PK_pixfmtPreMul))) {
            mk_jxr_close(handle);
            return NULL;
        }
        handle->raw = 1;
        handle->channels = channels;
        handle->decode->WMP.wmiI.cfColorFormat = NCOMPONENT;
        handle->decode->WMP.wmiI.cBitsPerUnit = channels * 8;
        handle->decode->WMP.wmiI.bRGB = 0;
        handle->decode->WMP.wmiI.cPostProcStrength = 0;
        handle->decode->WMP.wmiSCP.uAlphaMode = 0;
    }
    else if (known && (info.grBit & PK_pixfmtHasAlpha))
        handle->decode->WMP.wmiSCP.uAlphaMode = 2;
    return handle;
}

/*
 * The decoded image's shape into out[0..7]: width, height, bits per pixel, channels, colour
 * format (jxrlib COLORFORMAT), bit depth (BITDEPTH_BITS), flags (1 alpha, 2 BGR order,
 * 4 premultiplied). Returns 0, or -1 when the pixel format is unknown.
 */
EMSCRIPTEN_KEEPALIVE
int mk_jxr_info(MkJxr *handle, int *out)
{
    I32 width = 0, height = 0;
    GUID guid;
    PKPixelInfo info;
    if (handle->decode->GetSize(handle->decode, &width, &height) ||
        handle->decode->GetPixelFormat(handle->decode, &guid)) return -1;
    info.pGUIDPixFmt = &guid;
    if (PixelFormatLookup(&info, LOOKUP_FORWARD) != WMP_errSuccess) return -1;
    out[0] = width;
    out[1] = height;
    out[2] = (int)info.cbitUnit;
    out[3] = (int)info.cChannel;
    out[4] = (int)info.cfColorFormat;
    out[5] = (int)info.bdBitDepth;
    out[6] = ((info.grBit & PK_pixfmtHasAlpha) ? 1 : 0) | ((info.grBit & PK_pixfmtBGR) ? 2 : 0) |
        ((info.grBit & PK_pixfmtPreMul) ? 4 : 0);
    if (handle->raw) {
        out[2] = handle->channels * 8;
        out[3] = handle->channels;
        out[4] = NCOMPONENT;
        out[6] = 0;
    }
    return 0;
}

/* Decode the whole image into `dest` rows of `stride` bytes; 0, or -1 when decoding fails. */
EMSCRIPTEN_KEEPALIVE
int mk_jxr_copy(MkJxr *handle, void *dest, size_t stride)
{
    I32 width = 0, height = 0;
    if (handle->decode->GetSize(handle->decode, &width, &height)) return -1;
    PKRect rect = { 0, 0, width, height };
    return handle->decode->Copy(handle->decode, &rect, (U8 *)dest, (U32)stride) ? -1 : 0;
}
