/** Isolated C ABI feasibility bridge, not a Modkit API or another voxelizer.
 * Upstream owns triangle rasterization. One call per worker, no file inputs/outputs/threads.
 * Callback output is bounded native uint32 xyz/ARGB words (NOT serialized big-endian VL32).
 * Caller validates input arrays and bounds WASM memory; worker termination owns hard cancellation.
 */
#include "obj2voxel.h"
#include <emscripten.h>
#include <cstdint>
#include <memory>
#include <vector>

EM_JS(void, proof_input_entered, (), { if (globalThis.proofEntered) globalThis.proofEntered(); });

struct Input {
    const float *positions, *colours, *uvs;
    uint32_t count, cursor, mode;
    obj2voxel_texture *texture;
};
struct Output { std::vector<uint32_t> words; uint32_t maxCells; bool overflow = false; };
static Output result;

/** Supply borrowed triangles in original order using only the public upstream setters. */
static bool input(void *data, obj2voxel_triangle *triangle) {
    auto &in = *static_cast<Input *>(data);
    if (in.cursor == in.count) return false;
    if (in.cursor == 0) proof_input_entered();
    uint32_t i = in.cursor++;
    if (in.mode == 2) obj2voxel_set_triangle_textured(triangle, in.positions + i*9, in.uvs + i*6, in.texture);
    else obj2voxel_set_triangle_colored(triangle, in.positions + i*9, in.colours + i*3);
    return true;
}

/** Bound retained callback records before growing the output vector. */
static bool output(void *data, uint32_t *words, size_t count) {
    auto &out = *static_cast<Output *>(data);
    if (count > out.maxCells - out.words.size()/4) { out.overflow = true; return false; }
    out.words.insert(out.words.end(), words, words + count*4);
    return true;
}

extern "C" {
/** Run the original library with a single optional pixel texture, never an OBJ/MTL file. */
EMSCRIPTEN_KEEPALIVE int proof_run(const float *positions, const float *colours, const float *uvs,
    uint32_t triangles, uint32_t mode, const uint8_t *pixels, uint32_t width, uint32_t height,
    uint32_t resolution, uint32_t maxCells, uint32_t clamp) {
    result = Output{};
    result.maxCells = maxCells;
    auto instance = std::unique_ptr<obj2voxel_instance, decltype(&obj2voxel_free)>(obj2voxel_alloc(), obj2voxel_free);
    auto texture = std::unique_ptr<obj2voxel_texture, decltype(&obj2voxel_texture_free)>(nullptr, obj2voxel_texture_free);
    if (mode == 2) {
        texture.reset(obj2voxel_texture_alloc());
        if (!obj2voxel_texture_load_pixels(texture.get(), pixels, width, height, 3)) return 101;
        obj2voxel_teture_set_uv_mode(texture.get(), clamp ? OBJ2VOXEL_UV_CLAMP : OBJ2VOXEL_UV_WRAP);
    }
    Input in{positions, colours, uvs, triangles, 0, mode, texture.get()};
    obj2voxel_set_log_level(OBJ2VOXEL_LOG_LEVEL_SILENT);
    obj2voxel_set_resolution(instance.get(), resolution);
    obj2voxel_set_supersampling(instance.get(), 1);
    obj2voxel_set_color_strategy(instance.get(), OBJ2VOXEL_MAX_STRATEGY);
    obj2voxel_set_parallel(instance.get(), false);
    obj2voxel_set_input_callback(instance.get(), input, &in);
    obj2voxel_set_output_callback(instance.get(), output, &result);
    auto error = obj2voxel_voxelize(instance.get());
    return result.overflow ? 102 : error;
}
/** Borrow callback bytes until the worker copies and terminates. */
EMSCRIPTEN_KEEPALIVE const uint32_t *proof_output() { return result.words.data(); }
/** Report the exact record count, without guessing the vector capacity. */
EMSCRIPTEN_KEEPALIVE uint32_t proof_count() { return result.words.size()/4; }
}
