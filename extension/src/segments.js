// Segment indexes of YouTube's DASH files: ISO BMFF `sidx` (mp4) and Matroska `Cues` (webm).
// Both give, per media segment, its absolute byte range and its start time, so a clip needs
// only the init bytes plus the segments that overlap the requested window.

/** @typedef {{ start: number, end: number, t0: number, dur: number }} Segment  (bytes inclusive, seconds) */

function readU32(bytes, pos) {
  return ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
}

function readU64(bytes, pos) {
  return readU32(bytes, pos) * 2 ** 32 + readU32(bytes, pos + 4);
}

/** Parse the `sidx` box found at absolute file offset `indexOffset`. */
export function parseSidx(index, indexOffset) {
  let pos = 0;
  while (pos + 8 <= index.length) {
    let size = readU32(index, pos);
    const type = String.fromCharCode(index[pos + 4], index[pos + 5], index[pos + 6], index[pos + 7]);
    let header = 8;
    if (size === 1) {
      size = readU64(index, pos + 8);
      header = 16;
    }
    if (type === "sidx") {
      const version = index[pos + header];
      let p = pos + header + 4; // version + flags
      p += 4; // reference_ID
      const timescale = readU32(index, p);
      p += 4;
      let earliest;
      let firstOffset;
      if (version === 0) {
        earliest = readU32(index, p);
        firstOffset = readU32(index, p + 4);
        p += 8;
      } else {
        earliest = readU64(index, p);
        firstOffset = readU64(index, p + 8);
        p += 16;
      }
      p += 2; // reserved
      const count = (index[p] << 8) | index[p + 1];
      p += 2;
      const segments = [];
      let byteStart = indexOffset + pos + size + firstOffset;
      let time = earliest;
      for (let i = 0; i < count; i += 1) {
        const referencedSize = readU32(index, p) & 0x7fffffff;
        const duration = readU32(index, p + 4);
        p += 12;
        segments.push({ start: byteStart, end: byteStart + referencedSize - 1, t0: time / timescale, dur: duration / timescale });
        byteStart += referencedSize;
        time += duration;
      }
      return segments;
    }
    if (size < 8) break;
    pos += size;
  }
  throw new Error("The video index has no sidx box.");
}

// --- Matroska/WebM -------------------------------------------------------------------------

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMESTAMP_SCALE = 0x2ad7b1;
const ID_CUES = 0x1c53bb6b;
const ID_CUE_POINT = 0xbb;
const ID_CUE_TIME = 0xb3;
const ID_CUE_TRACK_POSITIONS = 0xb7;
const ID_CUE_CLUSTER_POSITION = 0xf1;

function vintLength(firstByte) {
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(firstByte & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8) throw new Error("Malformed EBML variable-length integer.");
  return length;
}

/** Element ID keeps its marker bits; sizes drop them. Returns `{ value, length, unknown }`. */
function readVint(bytes, pos, keepMarker) {
  const length = vintLength(bytes[pos]);
  let value = keepMarker ? bytes[pos] : bytes[pos] & (0xff >> length);
  let allOnes = value === (keepMarker ? bytes[pos] : 0xff >> length);
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function readUint(bytes, pos, length) {
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + bytes[pos + i];
  return value;
}

/** Iterate the elements laid out in `bytes[from, to)`, calling `visit(id, dataStart, dataSize, elementStart)`. */
export function walkEbml(bytes, from, to, visit) {
  let pos = from;
  while (pos < to) {
    const id = readVint(bytes, pos, true);
    const size = readVint(bytes, pos + id.length, false);
    const dataStart = pos + id.length + size.length;
    const dataSize = size.unknown ? to - dataStart : size.value;
    visit(id.value, dataStart, dataSize, pos);
    pos = dataStart + dataSize;
  }
}

/** From the init bytes: the absolute offset of the Segment's payload and the timestamp scale (ns). */
export function parseWebmInit(init) {
  let segmentDataStart = null;
  let timestampScale = 1_000_000;
  walkEbml(init, 0, init.length, (id, dataStart, dataSize) => {
    if (id !== ID_SEGMENT) return;
    segmentDataStart = dataStart;
    walkEbml(init, dataStart, Math.min(init.length, dataStart + dataSize), (childId, childStart, childSize) => {
      if (childId !== ID_INFO) return;
      walkEbml(init, childStart, childStart + childSize, (infoId, infoStart, infoSize) => {
        if (infoId === ID_TIMESTAMP_SCALE) timestampScale = readUint(init, infoStart, infoSize);
      });
    });
  });
  if (segmentDataStart == null) throw new Error("The WebM header has no Segment element.");
  return { segmentDataStart, timestampScale };
}

/**
 * Parse the `Cues` element (the webm index). Cluster positions are relative to the Segment
 * payload; the last cluster runs to the end of the file, whose total length is `contentLength`.
 */
export function parseCues(init, index, contentLength, totalDurationS) {
  const { segmentDataStart, timestampScale } = parseWebmInit(init);
  const points = [];
  walkEbml(index, 0, index.length, (id, dataStart, dataSize) => {
    if (id !== ID_CUES) return;
    walkEbml(index, dataStart, dataStart + dataSize, (pointId, pointStart, pointSize) => {
      if (pointId !== ID_CUE_POINT) return;
      let time = null;
      let position = null;
      walkEbml(index, pointStart, pointStart + pointSize, (fieldId, fieldStart, fieldSize) => {
        if (fieldId === ID_CUE_TIME) time = readUint(index, fieldStart, fieldSize);
        if (fieldId === ID_CUE_TRACK_POSITIONS) {
          walkEbml(index, fieldStart, fieldStart + fieldSize, (posId, posStart, posSize) => {
            if (posId === ID_CUE_CLUSTER_POSITION) position = readUint(index, posStart, posSize);
          });
        }
      });
      if (time != null && position != null) points.push({ time, position });
    });
  });
  if (!points.length) throw new Error("The WebM index has no cue points.");
  points.sort((a, b) => a.position - b.position);
  const toSeconds = (t) => (t * timestampScale) / 1e9;
  return points.map((point, i) => {
    const next = points[i + 1];
    const t0 = toSeconds(point.time);
    const tEnd = next ? toSeconds(next.time) : Math.max(t0, totalDurationS ?? t0);
    return {
      start: segmentDataStart + point.position,
      end: next ? segmentDataStart + next.position - 1 : contentLength - 1,
      t0,
      dur: tEnd - t0,
    };
  });
}

/** Dispatch on the format's container. */
export function parseIndex(format, init, index) {
  if (format.container === "mp4") return parseSidx(index, format.indexRange.start);
  if (format.container === "webm") return parseCues(init, index, format.contentLength, format.approxDurationMs / 1000);
  throw new Error(`Unsupported container: ${format.container}`);
}

/** The contiguous run of segments overlapping [from, to). */
export function chooseSegments(segments, from, to) {
  const chosen = segments.filter((s) => s.t0 + s.dur > from && s.t0 < to);
  if (!chosen.length) throw new Error("The requested range is outside the video.");
  return chosen;
}
