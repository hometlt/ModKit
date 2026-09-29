import {
  createCrc32Msb
} from "./chunk-TWH75SBL.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/ea-xa.js
var EA_XA_FRAME_SAMPLES = 28;
var EA_XAS_FRAME_BYTES = 76;
var EA_XAS_FRAME_SAMPLES = 128;
var WEIGHTS = [
  0,
  240,
  460,
  392,
  0,
  0,
  -208,
  -220,
  0,
  1,
  3,
  4,
  7,
  8,
  10,
  11,
  0,
  -1,
  -3,
  -4
];
var RAW_FRAME = 238;
function checkChannels(channels) {
  if (!Number.isInteger(channels) || channels < 1 || channels > 64) {
    throw new RangeError("EA-XA audio has 1 to 64 channels");
  }
}
var clamp16 = (value) => value < -32768 ? -32768 : value > 32767 ? 32767 : value;
function decodeEaXa(blocks, revision, channels) {
  if (revision !== 1 && revision !== 2 && revision !== 3) {
    throw new RangeError("EA-XA revision is 1, 2 or 3");
  }
  checkChannels(channels);
  const littleEndian = revision !== 3;
  const history1 = new Int32Array(channels);
  const history2 = new Int32Array(channels);
  const parts = [];
  let total = 0;
  for (const block of blocks) {
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const header = 4 + 4 * channels;
    if (block.byteLength < header)
      throw new RangeError("EA-XA block is shorter than its header");
    const samples = view.getUint32(0, littleEndian);
    const frames = Math.ceil(samples / EA_XA_FRAME_SAMPLES);
    if (channels * (frames * 15 + (revision === 1 ? 4 : 0)) > block.byteLength - header) {
      throw new RangeError("EA-XA block holds fewer frames than its sample count");
    }
    const out = new Int16Array(samples * channels);
    for (let channel = 0; channel < channels; channel += 1) {
      let at = header + view.getUint32(4 + 4 * channel, littleEndian);
      const need = (bytes) => {
        if (at + bytes > block.byteLength)
          throw new RangeError("EA-XA block ends inside a frame");
      };
      if (revision === 1) {
        need(4);
        history1[channel] = view.getInt16(at, true);
        history2[channel] = view.getInt16(at + 2, true);
        at += 4;
      }
      let previous = history1[channel] ?? 0;
      let beforePrevious = history2[channel] ?? 0;
      for (let index = 0; index < samples; index += EA_XA_FRAME_SAMPLES) {
        need(1);
        const head = block[at] ?? 0;
        at += 1;
        const count = Math.min(EA_XA_FRAME_SAMPLES, samples - index);
        if (head === RAW_FRAME) {
          need(4 + 2 * EA_XA_FRAME_SAMPLES);
          previous = view.getInt16(at, false);
          beforePrevious = view.getInt16(at + 2, false);
          for (let sample = 0; sample < count; sample += 1) {
            out[(index + sample) * channels + channel] = view.getInt16(at + 4 + 2 * sample, false);
          }
          at += 4 + 2 * EA_XA_FRAME_SAMPLES;
          continue;
        }
        need(EA_XA_FRAME_SAMPLES / 2);
        const weight1 = WEIGHTS[head >> 4] ?? 0;
        const weight2 = WEIGHTS[(head >> 4) + 4] ?? 0;
        const shift = 20 - (head & 15);
        for (let sample = 0; sample < EA_XA_FRAME_SAMPLES; sample += 1) {
          const byte = block[at + (sample >> 1)] ?? 0;
          const code = (sample & 1) === 0 ? byte << 24 >> 28 : byte << 28 >> 28;
          const decoded = clamp16((code << shift) + previous * weight1 + beforePrevious * weight2 >> 8);
          beforePrevious = previous;
          previous = decoded;
          if (sample < count)
            out[(index + sample) * channels + channel] = decoded;
        }
        at += EA_XA_FRAME_SAMPLES / 2;
      }
      history1[channel] = previous;
      history2[channel] = beforePrevious;
    }
    parts.push(out);
    total += out.length;
  }
  const pcm = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    pcm.set(part, offset);
    offset += part.length;
  }
  return pcm;
}
function decodeEaXas(frames, channels, samples) {
  checkChannels(channels);
  const stride = EA_XAS_FRAME_BYTES * channels;
  if (frames.byteLength % stride !== 0) {
    throw new RangeError(`EA-XAS data is not a whole number of ${stride}-byte frames`);
  }
  const count = frames.byteLength / stride;
  const available = count * EA_XAS_FRAME_SAMPLES;
  const length = samples ?? available;
  if (!Number.isInteger(length) || length < 0 || length > available) {
    throw new RangeError(`EA-XAS frames hold ${available} samples per channel, not ${length}`);
  }
  const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);
  const out = new Int16Array(length * channels);
  for (let frame = 0; frame < count; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const at = (frame * channels + channel) * EA_XAS_FRAME_BYTES;
      for (let group = 0; group < 4; group += 1) {
        const first = view.getInt16(at + 4 * group, true);
        const second = view.getInt16(at + 4 * group + 2, true);
        const weight1 = WEIGHTS[first & 15] ?? 0;
        const weight2 = WEIGHTS[(first & 15) + 4] ?? 0;
        const shift = 20 - (second & 15);
        const start = frame * EA_XAS_FRAME_SAMPLES + group * 32;
        const put = (position, value) => {
          if (start + position < length)
            out[(start + position) * channels + channel] = value;
        };
        let beforePrevious = first & ~15;
        let previous = second & ~15;
        put(0, beforePrevious);
        put(1, previous);
        for (let row = 0; row < 15; row += 1) {
          const byte = frames[at + 16 + 4 * row + group] ?? 0;
          for (let half = 0; half < 2; half += 1) {
            const code = half === 0 ? byte << 24 >> 28 : byte << 28 >> 28;
            const decoded = clamp16((code << shift) + previous * weight1 + beforePrevious * weight2 + 128 >> 8);
            beforePrevious = previous;
            previous = decoded;
            put(2 + 2 * row + half, decoded);
          }
        }
      }
    }
  }
  return out;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/fadpcm.js
var FRAME_BYTES = 140;
var SAMPLES_PER_FRAME = 256;
var COEFFICIENTS = [
  [0, 0],
  [60, 0],
  [122, 60],
  [115, 52],
  [98, 55],
  [0, 0],
  [0, 0]
];
function fadpcmFrames(sampleCount) {
  return Math.ceil(sampleCount / SAMPLES_PER_FRAME);
}
function decodeFadpcm(data, channels, sampleCount) {
  if (!Number.isInteger(channels) || channels < 1)
    throw new RangeError("FADPCM needs 1+ channels");
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) {
    throw new RangeError("FADPCM sample count must be a non-negative integer");
  }
  const frames = fadpcmFrames(sampleCount);
  if (frames * FRAME_BYTES * channels > data.byteLength) {
    throw new RangeError(`FADPCM data holds fewer than ${frames} frames of ${channels} channel(s)`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Int16Array(sampleCount * channels);
  for (let frame = 0; frame < frames; frame += 1) {
    const first = frame * SAMPLES_PER_FRAME;
    const count = Math.min(SAMPLES_PER_FRAME, sampleCount - first);
    for (let channel = 0; channel < channels; channel += 1) {
      const at = (frame * channels + channel) * FRAME_BYTES;
      const coefficients = view.getUint32(at, true);
      const shifts = view.getUint32(at + 4, true);
      let history1 = view.getInt16(at + 8, true);
      let history2 = view.getInt16(at + 10, true);
      let index = 0;
      for (let group = 0; group < 8; group += 1) {
        const [coefficient1, coefficient2] = COEFFICIENTS[(coefficients >>> group * 4 & 15) % 7] ?? [0, 0];
        const shift = 22 - (shifts >>> group * 4 & 15);
        for (let word = 0; word < 4; word += 1) {
          const codes = view.getUint32(at + 12 + group * 16 + word * 4, true);
          for (let nibble = 0; nibble < 8; nibble += 1) {
            let sample = (codes >>> nibble * 4 & 15) << 28 >> shift;
            sample = sample - history2 * coefficient2 + history1 * coefficient1 >> 6;
            sample = sample < -32768 ? -32768 : sample > 32767 ? 32767 : sample;
            if (index < count)
              out[(first + index) * channels + channel] = sample;
            index += 1;
            history2 = history1;
            history1 = sample;
          }
        }
      }
    }
  }
  return out;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/xa-adpcm.js
var XA_SOUND_GROUP_BYTES = 128;
var XA_SOUND_GROUP_SAMPLES = 224;
var UNIT_SAMPLES = 28;
var FILTERS = [
  [0, 0],
  [60, 0],
  [115, -52],
  [98, -55]
];
function decodeXaAdpcm(groups, channels) {
  if (channels !== 1 && channels !== 2)
    throw new RangeError("XA ADPCM is mono or stereo");
  if (groups.byteLength % XA_SOUND_GROUP_BYTES !== 0) {
    throw new RangeError(`XA ADPCM data is not a whole number of ${XA_SOUND_GROUP_BYTES}-byte groups`);
  }
  const count = groups.byteLength / XA_SOUND_GROUP_BYTES;
  const out = new Int16Array(count * XA_SOUND_GROUP_SAMPLES);
  const states = [
    { history1: 0, history2: 0, written: 0 },
    { history1: 0, history2: 0, written: 0 }
  ];
  for (let group = 0; group < count; group += 1) {
    const at = group * XA_SOUND_GROUP_BYTES;
    for (let unit = 0; unit < 8; unit += 1) {
      const parameters = groups[at + 4 + unit] ?? 0;
      const raw = parameters & 15;
      const shift = raw > 12 ? 9 : raw;
      const [weight1, weight2] = FILTERS[parameters >> 4 & 3] ?? [0, 0];
      const channel = channels === 2 ? unit & 1 : 0;
      const state = states[channel === 0 ? 0 : 1];
      let { history1, history2, written: index } = state;
      const column = unit >> 1;
      const nibble = (unit & 1) * 4;
      for (let row = 0; row < UNIT_SAMPLES; row += 1) {
        const byte = groups[at + 16 + row * 4 + column] ?? 0;
        const code = byte >> nibble << 28 >> 16 >> shift;
        let sample = code + (history1 * weight1 + history2 * weight2 + 32 >> 6);
        sample = sample < -32768 ? -32768 : sample > 32767 ? 32767 : sample;
        out[index * channels + channel] = sample;
        index += 1;
        history2 = history1;
        history1 = sample;
      }
      state.written = index;
      state.history1 = history1;
      state.history2 = history2;
    }
  }
  return out;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/ima.js
var IMA_STEP_TABLE = Object.freeze([
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  16,
  17,
  19,
  21,
  23,
  25,
  28,
  31,
  34,
  37,
  41,
  45,
  50,
  55,
  60,
  66,
  73,
  80,
  88,
  97,
  107,
  118,
  130,
  143,
  157,
  173,
  190,
  209,
  230,
  253,
  279,
  307,
  337,
  371,
  408,
  449,
  494,
  544,
  598,
  658,
  724,
  796,
  876,
  963,
  1060,
  1166,
  1282,
  1411,
  1552,
  1707,
  1878,
  2066,
  2272,
  2499,
  2749,
  3024,
  3327,
  3660,
  4026,
  4428,
  4871,
  5358,
  5894,
  6484,
  7132,
  7845,
  8630,
  9493,
  10442,
  11487,
  12635,
  13899,
  15289,
  16818,
  18500,
  20350,
  22385,
  24623,
  27086,
  29794,
  32767
]);
var IMA_INDEX_TABLE = Object.freeze([
  -1,
  -1,
  -1,
  -1,
  2,
  4,
  6,
  8,
  -1,
  -1,
  -1,
  -1,
  2,
  4,
  6,
  8
]);
function decodeImaAdpcmBlock(block, channels) {
  const header = 4 * channels;
  if (channels <= 0 || block.byteLength < header)
    return new Int16Array(0);
  const groups = Math.floor((block.byteLength - header) / header);
  const out = new Int16Array((1 + groups * 8) * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const at = 4 * channel;
    let predictor = ((block[at] ?? 0) | (block[at + 1] ?? 0) << 8) << 16 >> 16;
    let index = Math.min(88, block[at + 2] ?? 0);
    out[channel] = predictor;
    for (let group = 0; group < groups; group += 1) {
      const word = header + (group * channels + channel) * 4;
      for (let nibble = 0; nibble < 8; nibble += 1) {
        const code = (block[word + (nibble >> 1)] ?? 0) >> (nibble & 1) * 4 & 15;
        const step = IMA_STEP_TABLE[index] ?? 0;
        let difference = step >> 3;
        if ((code & 1) !== 0)
          difference += step >> 2;
        if ((code & 2) !== 0)
          difference += step >> 1;
        if ((code & 4) !== 0)
          difference += step;
        predictor += (code & 8) !== 0 ? -difference : difference;
        predictor = predictor < -32768 ? -32768 : predictor > 32767 ? 32767 : predictor;
        index = Math.min(88, Math.max(0, index + (IMA_INDEX_TABLE[code] ?? 0)));
        out[(1 + group * 8 + nibble) * channels + channel] = predictor;
      }
    }
  }
  return out;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/mpeg.js
var MPEG1_BITRATES = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
];
var MPEG2_BITRATES = [
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
];
var SAMPLE_RATES = [44100, 48e3, 32e3];
function mpegAudioFrame(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength)
    return void 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;
  if (bytes[offset] !== 255 || (b1 & 224) !== 224)
    return void 0;
  const versionBits = b1 >> 3 & 3;
  const layerBits = b1 >> 1 & 3;
  const bitrateIndex = b2 >> 4 & 15;
  const rateIndex = b2 >> 2 & 3;
  if (versionBits === 1 || layerBits === 0 || rateIndex === 3)
    return void 0;
  if (bitrateIndex === 0 || bitrateIndex === 15)
    return void 0;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = 4 - layerBits;
  const bitrates = version === 1 ? MPEG1_BITRATES[layer - 1] : MPEG2_BITRATES[layer === 1 ? 0 : 1];
  const bitrateKbps = bitrates?.[bitrateIndex] ?? 0;
  const sampleRate = (SAMPLE_RATES[rateIndex] ?? 0) / (version === 1 ? 1 : version === 2 ? 2 : 4);
  const padding = b2 >> 1 & 1;
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
  const frameBytes = layer === 1 ? (Math.floor(12e3 * bitrateKbps / sampleRate) + padding) * 4 : Math.floor(samples / 8 * 1e3 * bitrateKbps / sampleRate) + padding;
  return {
    version,
    layer,
    bitrateKbps,
    sampleRate,
    channels: (b3 >> 6 & 3) === 3 ? 1 : 2,
    samples,
    bytes: frameBytes
  };
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/vorbis.js
var signature = (type) => [type, 118, 111, 114, 98, 105, 115];
function vorbisIdentificationHeader(info) {
  const [small, large] = info.blocksizes;
  if (!Number.isInteger(info.channels) || info.channels < 1 || info.channels > 255) {
    throw new RangeError("Vorbis channels must be 1..255");
  }
  if (!(small >= 6 && small <= large && large <= 13)) {
    throw new RangeError("Vorbis block sizes must be 2^6..2^13, short not above long");
  }
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  bytes.set(signature(1));
  view.setUint32(7, 0, true);
  bytes[11] = info.channels;
  view.setUint32(12, info.sampleRate, true);
  view.setUint32(20, (info.nominalBitrate ?? 0) >>> 0, true);
  bytes[28] = small | large << 4;
  bytes[29] = 1;
  return bytes;
}
function vorbisCommentHeader(vendor) {
  const name = new TextEncoder().encode(vendor);
  const bytes = new Uint8Array(7 + 4 + name.byteLength + 4 + 1);
  const view = new DataView(bytes.buffer);
  bytes.set(signature(3));
  view.setUint32(7, name.byteLength, true);
  bytes.set(name, 11);
  bytes[bytes.byteLength - 1] = 1;
  return bytes;
}
function vorbisModeBlockflags(setup) {
  if (setup[0] !== 5)
    throw new TypeError("not a Vorbis setup header");
  const bit = (index) => (setup[index >> 3] ?? 0) >> (index & 7) & 1;
  const read = (index, width) => {
    let value = 0;
    for (let offset = 0; offset < width; offset += 1)
      value |= bit(index + offset) << offset;
    return value >>> 0;
  };
  let last = setup.byteLength - 1;
  while (last > 0 && setup[last] === 0)
    last -= 1;
  const top = setup[last] ?? 0;
  if (top === 0)
    throw new TypeError("Vorbis setup header has no framing bit");
  const framing = last * 8 + (31 - Math.clz32(top));
  let candidates = 0;
  for (let count = 1; count <= 64; count += 1) {
    const start = framing - 41 * count;
    if (start < 7 * 8 || read(start + 1, 16) !== 0 || read(start + 17, 16) !== 0)
      break;
    if (read(start + 33, 8) > 63)
      break;
    candidates = count;
  }
  for (let count = candidates; count >= 1; count -= 1) {
    const start = framing - 41 * count;
    if (start - 6 >= 7 * 8 && read(start - 6, 6) === count - 1) {
      return Array.from({ length: count }, (_, mode) => bit(start + 41 * mode) === 1);
    }
  }
  throw new TypeError("Vorbis setup header modes could not be read");
}
function vorbisPacketsToOgg(options) {
  const blockflags = options.blockflags ?? vorbisModeBlockflags(options.setup);
  if (blockflags.length === 0)
    throw new TypeError("Vorbis setup header has no modes");
  const modeBits = 32 - Math.clz32(blockflags.length - 1);
  const modeMask = (1 << modeBits) - 1;
  const [small, large] = options.info.blocksizes;
  const packets = [
    { bytes: vorbisIdentificationHeader(options.info), granule: 0n, flush: true },
    { bytes: vorbisCommentHeader(options.vendor), granule: 0n },
    { bytes: options.setup, granule: 0n, flush: true }
  ];
  let previousSize = 0;
  let granule = 0n;
  for (const packet of options.packets) {
    const first = packet[0] ?? 0;
    if ((first & 1) !== 0)
      throw new TypeError("a Vorbis audio packet starts with a zero bit");
    const mode = first >> 1 & modeMask;
    const flag = blockflags[mode];
    if (flag === void 0)
      throw new RangeError(`Vorbis packet names mode ${mode}`);
    const size = 1 << (flag ? large : small);
    if (previousSize > 0)
      granule += BigInt((previousSize + size) / 4);
    previousSize = size;
    packets.push({ bytes: packet, granule });
  }
  if (packets.length === 3)
    throw new TypeError("the Vorbis stream holds no audio packets");
  const lastIndex = packets.length - 1;
  const lastPacket = packets[lastIndex];
  if (lastPacket !== void 0 && options.sampleCount !== void 0 && BigInt(options.sampleCount) < lastPacket.granule) {
    packets[lastIndex] = { ...lastPacket, granule: BigInt(options.sampleCount) };
  }
  return encodeOgg(packets, options.serial ?? 1);
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/westwood.js
var WS_4BIT_DELTAS = [-9, -8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8];
function decodeImaWs(chunks, channels, layout = "interleaved") {
  if (channels !== 1 && channels !== 2)
    throw new RangeError("Westwood IMA ADPCM is mono or stereo");
  let bytes = 0;
  for (const chunk of chunks) {
    if (chunk.byteLength % channels !== 0) {
      throw new RangeError("a stereo Westwood IMA ADPCM chunk has an odd number of bytes");
    }
    bytes += chunk.byteLength;
  }
  const out = new Int16Array(bytes * 2);
  const predictors = [0, 0];
  const indices = [0, 0];
  const next = (channel, code) => {
    const index = indices[channel] ?? 0;
    const difference = (2 * (code & 7) + 1) * (IMA_STEP_TABLE[index] ?? 0) >> 3;
    const predictor = (predictors[channel] ?? 0) + ((code & 8) !== 0 ? -difference : difference);
    const clamped = predictor < -32768 ? -32768 : predictor > 32767 ? 32767 : predictor;
    predictors[channel] = clamped;
    indices[channel] = Math.min(88, Math.max(0, index + (IMA_INDEX_TABLE[code] ?? 0)));
    return clamped;
  };
  let written = 0;
  for (const chunk of chunks) {
    if (channels === 1) {
      for (const byte of chunk) {
        out[written++] = next(0, byte & 15);
        out[written++] = next(0, byte >> 4);
      }
      continue;
    }
    const half = chunk.byteLength / 2;
    for (let pair = 0; pair < half; pair += 1) {
      const left = chunk[layout === "planar" ? pair : 2 * pair] ?? 0;
      const right = chunk[layout === "planar" ? half + pair : 2 * pair + 1] ?? 0;
      out[written++] = next(0, left & 15);
      out[written++] = next(1, right & 15);
      out[written++] = next(0, left >> 4);
      out[written++] = next(1, right >> 4);
    }
  }
  return out;
}
function decodeWsAdpcm(chunks) {
  let total = 0;
  for (const { samples } of chunks) {
    if (!Number.isInteger(samples) || samples < 0)
      throw new RangeError("WS SND1 sample count must be a whole number");
    total += samples;
  }
  const out = new Int16Array(total);
  let written = 0;
  for (const { data, samples } of chunks) {
    const end = written + samples;
    let sample = 128;
    const put = (value) => {
      sample = value < 0 ? 0 : value > 255 ? 255 : value;
      out[written++] = sample - 128 << 8;
    };
    if (data.byteLength === samples) {
      for (const byte of data)
        put(byte);
      continue;
    }
    let at = 0;
    while (written < end && at < data.byteLength) {
      const byte = data[at++] ?? 0;
      const code = byte >> 6;
      const count = (byte & 63) + 1;
      const size = code === 0 ? 4 * count : code === 1 ? 2 * count : code === 2 && (byte & 32) !== 0 ? 1 : count;
      const input = code === 3 || code === 2 && (byte & 32) !== 0 ? 0 : count;
      if (end - written < size || data.byteLength - at < input)
        break;
      if (code === 0) {
        for (let k = 0; k < count; k += 1) {
          const bits = data[at++] ?? 0;
          for (let shift = 0; shift < 8; shift += 2)
            put(sample + (bits >> shift & 3) - 2);
        }
      } else if (code === 1) {
        for (let k = 0; k < count; k += 1) {
          const bits = data[at++] ?? 0;
          put(sample + (WS_4BIT_DELTAS[bits & 15] ?? 0));
          put(sample + (WS_4BIT_DELTAS[bits >> 4] ?? 0));
        }
      } else if (code === 2 && (byte & 32) !== 0) {
        put(sample + ((byte & 31) << 27 >> 27));
      } else if (code === 2) {
        for (let k = 0; k < count; k += 1)
          put(data[at++] ?? 0);
      } else {
        for (let k = 0; k < count; k += 1)
          put(sample);
      }
    }
    while (written < end)
      put(sample);
  }
  return out;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/index.js
var PCM_BITS = [8, 16, 24, 32];
function checkShape(channels, sampleRate) {
  if (!Number.isInteger(channels) || channels < 1 || channels > 65535) {
    throw new RangeError("WAV channels must be 1..65535");
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 4294967295) {
    throw new RangeError("WAV sample rate must be a positive 32-bit integer");
  }
}
function formatChunk(format, dataBytes) {
  checkShape(format.channels, format.sampleRate);
  const { channels, sampleRate } = format;
  if (format.encoding === "pcm") {
    if (!PCM_BITS.includes(format.bitsPerSample)) {
      throw new RangeError("WAV PCM is 8, 16, 24 or 32 bits");
    }
    const blockAlign2 = channels * (format.bitsPerSample / 8);
    if (blockAlign2 > 65535)
      throw new RangeError("WAV frame exceeds 65535 bytes");
    if (dataBytes % blockAlign2 !== 0) {
      throw new RangeError(`WAV data is not a whole number of ${blockAlign2}-byte frames`);
    }
    if (sampleRate * blockAlign2 > 4294967295)
      throw new RangeError("WAV byte rate exceeds 32 bits");
    const fmt2 = new DataView(new ArrayBuffer(16));
    fmt2.setUint16(0, 1, true);
    fmt2.setUint16(2, channels, true);
    fmt2.setUint32(4, sampleRate, true);
    fmt2.setUint32(8, sampleRate * blockAlign2, true);
    fmt2.setUint16(12, blockAlign2, true);
    fmt2.setUint16(14, format.bitsPerSample, true);
    return { fmt: new Uint8Array(fmt2.buffer), fact: void 0 };
  }
  const { blockAlign } = format;
  const header = 4 * channels;
  if (!Number.isInteger(blockAlign) || blockAlign <= header || blockAlign > 65535 || (blockAlign - header) % header !== 0) {
    throw new RangeError(`IMA ADPCM block of ${blockAlign} bytes does not fit ${channels} channel(s)`);
  }
  const samplesPerBlock = 1 + (blockAlign - header) * 2 / channels;
  const tail = dataBytes % blockAlign;
  const tailSamples = tail < header ? 0 : 1 + Math.floor((tail - header) / header) * 8;
  const fmt = new DataView(new ArrayBuffer(20));
  fmt.setUint16(0, 17, true);
  fmt.setUint16(2, channels, true);
  fmt.setUint32(4, sampleRate, true);
  fmt.setUint32(8, Math.round(sampleRate * blockAlign / samplesPerBlock), true);
  fmt.setUint16(12, blockAlign, true);
  fmt.setUint16(14, 4, true);
  fmt.setUint16(16, 2, true);
  fmt.setUint16(18, samplesPerBlock, true);
  return {
    fmt: new Uint8Array(fmt.buffer),
    fact: Math.floor(dataBytes / blockAlign) * samplesPerBlock + tailSamples
  };
}
function wavHeader(format, dataBytes) {
  if (!Number.isSafeInteger(dataBytes) || dataBytes < 0) {
    throw new RangeError("WAV data size must be a non-negative integer");
  }
  const { fmt, fact } = formatChunk(format, dataBytes);
  const size = 12 + 8 + fmt.byteLength + (fact === void 0 ? 0 : 12) + 8;
  const riffSize = size - 8 + dataBytes + (dataBytes & 1);
  if (riffSize > 4294967295)
    throw new RangeError("WAV data exceeds the 4 GiB RIFF limit");
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const chunk = (id, length) => {
    for (let index = 0; index < 4; index += 1)
      bytes[at + index] = id.charCodeAt(index);
    view.setUint32(at + 4, length, true);
    at += 8;
  };
  chunk("RIFF", riffSize);
  bytes.set([87, 65, 86, 69], at);
  at += 4;
  chunk("fmt ", fmt.byteLength);
  bytes.set(fmt, at);
  at += fmt.byteLength;
  if (fact !== void 0) {
    chunk("fact", 4);
    view.setUint32(at, fact, true);
    at += 4;
  }
  chunk("data", dataBytes);
  return bytes;
}
function wavEntrySource(read, format, offset, length) {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("WAV entry offset must be a non-negative integer");
  }
  const header = wavHeader(format, length);
  const streamEnd = header.byteLength + length;
  const total = streamEnd + (length & 1);
  return Object.freeze({
    size: async () => BigInt(total),
    async read(start, count, signal) {
      const from = Number(start);
      if (!Number.isSafeInteger(from) || from < 0 || from > total || !Number.isSafeInteger(count) || count < 0) {
        throw new RangeError("WAV entry range is outside the entry");
      }
      const end = Math.min(total, from + count);
      const out = new Uint8Array(end - from);
      let cursor = from;
      if (cursor < header.byteLength) {
        const take = Math.min(header.byteLength, end) - cursor;
        out.set(header.subarray(cursor, cursor + take));
        cursor += take;
      }
      if (cursor < Math.min(streamEnd, end)) {
        const take = Math.min(streamEnd, end) - cursor;
        const bytes = await read(offset + cursor - header.byteLength, take, signal);
        if (bytes.byteLength !== take)
          throw new RangeError("WAV entry stream read is truncated");
        out.set(bytes, cursor - from);
      }
      return out;
    }
  });
}
function encodeWav(format, samples) {
  const header = wavHeader({ ...format, encoding: "pcm" }, samples.byteLength);
  const bytes = new Uint8Array(header.byteLength + samples.byteLength + (samples.byteLength & 1));
  bytes.set(header);
  bytes.set(samples, header.byteLength);
  return bytes;
}
var PAGE_HEADER_BYTES = 27;
var MAX_SEGMENTS = 255;
var PAGE_BODY_TARGET = 4096;
function encodeOgg(packets, serial) {
  if (packets.length === 0)
    throw new RangeError("an Ogg stream needs at least one packet");
  if (!Number.isInteger(serial) || serial < 0 || serial > 4294967295) {
    throw new RangeError("Ogg serial must be a 32-bit unsigned integer");
  }
  const pages = [];
  let lacing = [];
  let body = [];
  let bodyBytes = 0;
  let granule = -1n;
  let continued = false;
  const emit = (last) => {
    const page = new Uint8Array(PAGE_HEADER_BYTES + lacing.length + bodyBytes);
    const view = new DataView(page.buffer);
    page.set([79, 103, 103, 83], 0);
    page[5] = (continued ? 1 : 0) | (pages.length === 0 ? 2 : 0) | (last ? 4 : 0);
    view.setBigUint64(6, BigInt.asUintN(64, granule), true);
    view.setUint32(14, serial, true);
    view.setUint32(18, pages.length, true);
    page[26] = lacing.length;
    page.set(lacing, PAGE_HEADER_BYTES);
    let at2 = PAGE_HEADER_BYTES + lacing.length;
    for (const part of body) {
      page.set(part, at2);
      at2 += part.byteLength;
    }
    const crc = createCrc32Msb({ init: 0, xorOut: 0 });
    for (const byte of page)
      crc.update(byte);
    view.setUint32(22, crc.digest(), true);
    pages.push(page);
    lacing = [];
    body = [];
    bodyBytes = 0;
    granule = -1n;
  };
  packets.forEach((packet, index) => {
    const last = index === packets.length - 1;
    let offset = 0;
    for (; ; ) {
      if (lacing.length === MAX_SEGMENTS) {
        emit(false);
        continued = offset > 0;
      }
      const segment = Math.min(255, packet.bytes.byteLength - offset);
      lacing.push(segment);
      body.push(packet.bytes.subarray(offset, offset + segment));
      bodyBytes += segment;
      offset += segment;
      if (segment < 255)
        break;
    }
    granule = packet.granule;
    if (last || packet.flush === true || bodyBytes >= PAGE_BODY_TARGET) {
      emit(last);
      continued = false;
    }
  });
  const out = new Uint8Array(pages.reduce((total, page) => total + page.byteLength, 0));
  let at = 0;
  for (const page of pages) {
    out.set(page, at);
    at += page.byteLength;
  }
  return out;
}

export {
  EA_XA_FRAME_SAMPLES,
  EA_XAS_FRAME_BYTES,
  EA_XAS_FRAME_SAMPLES,
  decodeEaXa,
  decodeEaXas,
  fadpcmFrames,
  decodeFadpcm,
  XA_SOUND_GROUP_BYTES,
  XA_SOUND_GROUP_SAMPLES,
  decodeXaAdpcm,
  IMA_STEP_TABLE,
  IMA_INDEX_TABLE,
  decodeImaAdpcmBlock,
  mpegAudioFrame,
  vorbisIdentificationHeader,
  vorbisCommentHeader,
  vorbisModeBlockflags,
  vorbisPacketsToOgg,
  decodeImaWs,
  decodeWsAdpcm,
  wavHeader,
  wavEntrySource,
  encodeWav,
  encodeOgg
};
