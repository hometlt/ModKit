import {
  crc32
} from "./chunk-SITZA5RP.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/container/zip.js
var ZIP_LOCAL = 67324752;
var ZIP_CENTRAL = 33639248;
var ZIP_EOCD = 101010256;
var ZIP_FLAG_UTF8_NAMES = 2048;
var MAX_U16 = 65535;
var MAX_U32 = 4294967295;
var DOS_EPOCH_DATE = 33;
var STORED = 0;
var VERSION_STORED = 10;
var VERSION_MADE_BY = 20;
var EMPTY = new Uint8Array(0);
var encoder = new TextEncoder();
function zipLocalHeader(fields) {
  const header = new Uint8Array(30 + fields.nameBytes.byteLength + fields.extraBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, ZIP_LOCAL, true);
  view.setUint16(4, fields.versionNeeded, true);
  view.setUint16(6, fields.flags, true);
  view.setUint16(8, fields.method, true);
  view.setUint16(10, fields.dosTime, true);
  view.setUint16(12, fields.dosDate, true);
  view.setUint32(14, fields.crc, true);
  view.setUint32(18, fields.compressedSize, true);
  view.setUint32(22, fields.size, true);
  view.setUint16(26, fields.nameBytes.byteLength, true);
  view.setUint16(28, fields.extraBytes.byteLength, true);
  header.set(fields.nameBytes, 30);
  header.set(fields.extraBytes, 30 + fields.nameBytes.byteLength);
  return header;
}
function zipCentralRecord(fields) {
  const nameLength = fields.nameBytes.byteLength;
  const extraLength = fields.extraBytes.byteLength;
  const commentLength = fields.commentBytes.byteLength;
  const record = new Uint8Array(46 + nameLength + extraLength + commentLength);
  const view = new DataView(record.buffer);
  view.setUint32(0, ZIP_CENTRAL, true);
  view.setUint16(4, fields.versionMadeBy, true);
  view.setUint16(6, fields.versionNeeded, true);
  view.setUint16(8, fields.flags, true);
  view.setUint16(10, fields.method, true);
  view.setUint16(12, fields.dosTime, true);
  view.setUint16(14, fields.dosDate, true);
  view.setUint32(16, fields.crc, true);
  view.setUint32(20, fields.compressedSize, true);
  view.setUint32(24, fields.size, true);
  view.setUint16(28, nameLength, true);
  view.setUint16(30, extraLength, true);
  view.setUint16(32, commentLength, true);
  view.setUint16(34, fields.diskStart, true);
  view.setUint16(36, fields.internalAttributes, true);
  view.setUint32(38, fields.externalAttributes, true);
  record.set(fields.nameBytes, 46);
  record.set(fields.extraBytes, 46 + nameLength);
  record.set(fields.commentBytes, 46 + nameLength + extraLength);
  return record;
}
function zipEntryName(name) {
  const nameBytes = encoder.encode(name);
  if (nameBytes.byteLength === 0)
    throw new TypeError("a ZIP entry path cannot be empty");
  if (nameBytes.byteLength > MAX_U16)
    throw new RangeError(`the ZIP entry path \xAB${name}\xBB is too long`);
  return nameBytes;
}
var zipNeedsUtf8Flag = (nameBytes) => nameBytes.some((byte) => byte >= 128);
function zipStoredEntry(name, data) {
  const directory = name.endsWith("/");
  if (directory && data.byteLength > 0)
    throw new TypeError(`\xAB${name}\xBB is a directory entry and carries no bytes`);
  const nameBytes = zipEntryName(name);
  const shared = {
    versionNeeded: VERSION_STORED,
    flags: zipNeedsUtf8Flag(nameBytes) ? ZIP_FLAG_UTF8_NAMES : 0,
    method: STORED,
    dosTime: 0,
    dosDate: DOS_EPOCH_DATE,
    crc: directory ? 0 : crc32(data),
    compressedSize: data.byteLength,
    size: data.byteLength,
    nameBytes,
    extraBytes: EMPTY
  };
  return Object.freeze({
    name,
    local: Object.freeze([zipLocalHeader(shared), data]),
    central: zipCentralRecord({
      ...shared,
      versionMadeBy: VERSION_MADE_BY,
      diskStart: 0,
      internalAttributes: 0,
      externalAttributes: directory ? 16 : 0,
      commentBytes: EMPTY
    })
  });
}
function assembleZipArchive(entries, comment, budget) {
  if (entries.length > MAX_U16) {
    throw new RangeError("the archive would need ZIP64: more than 65535 entries");
  }
  if (entries.length > budget.maxNodes) {
    throw new RangeError("the archive exceeds the maxNodes budget");
  }
  let localTotal = 0;
  let centralTotal = 0;
  for (const item of entries) {
    for (const part of item.local)
      localTotal += part.byteLength;
    centralTotal += item.central.byteLength;
  }
  const total = localTotal + centralTotal + 22 + comment.byteLength;
  if (total > MAX_U32) {
    throw new RangeError("the archive would need ZIP64: more than 4 GiB of output");
  }
  if (BigInt(total) > budget.maxInputBytes) {
    throw new RangeError("the archive exceeds the maxInputBytes budget");
  }
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const item of entries) {
    new DataView(item.central.buffer, item.central.byteOffset, item.central.byteLength).setUint32(42, cursor, true);
    for (const part of item.local) {
      out.set(part, cursor);
      cursor += part.byteLength;
    }
  }
  const centralStart = cursor;
  for (const item of entries) {
    out.set(item.central, cursor);
    cursor += item.central.byteLength;
  }
  const view = new DataView(out.buffer);
  view.setUint32(cursor, ZIP_EOCD, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, entries.length, true);
  view.setUint16(cursor + 10, entries.length, true);
  view.setUint32(cursor + 12, centralTotal, true);
  view.setUint32(cursor + 16, centralStart, true);
  view.setUint16(cursor + 20, comment.byteLength, true);
  out.set(comment, cursor + 22);
  return out;
}
function createZipArchive(files, budget) {
  const seen = /* @__PURE__ */ new Set();
  const entries = [];
  for (const [name, data] of files) {
    if (seen.has(name))
      throw new TypeError(`\xAB${name}\xBB would be in the archive twice`);
    seen.add(name);
    entries.push(zipStoredEntry(name, data));
  }
  return assembleZipArchive(entries, EMPTY, budget);
}

export {
  ZIP_FLAG_UTF8_NAMES,
  zipLocalHeader,
  zipCentralRecord,
  zipEntryName,
  zipNeedsUtf8Flag,
  zipStoredEntry,
  assembleZipArchive,
  createZipArchive
};
