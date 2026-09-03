import { encode as _encode, decode as _decode } from "cbor-x";

export interface Encoder {
  encode(value: unknown): Uint8Array;
  decode(data: Uint8Array): unknown;
}

export interface FrameEncoderOptions {
  /** Maximum encoded frame size accepted by encode() and decode(). */
  maxFrameSize?: number;
}

/**
 * A Codex is a registry of named encoders.
 * The FrameEncoder consults `head.encoding` to pick the right one.
 */
export interface Codex {
  [name: string]: Encoder;
}

function isArrayBufferLike(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return ArrayBuffer.isView(v)
    || Object.prototype.toString.call(v) === "[object ArrayBuffer]";
}

function toUint8Array(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return new Uint8Array(v as ArrayBuffer);
}

/** Built-in binary encoder: passes ArrayBuffer / ArrayBufferView through as-is. */
const binaryEncoder: Encoder = {
  encode(value: unknown): Uint8Array {
    if (!isArrayBufferLike(value)) throw new Error("binary encoder requires ArrayBuffer or ArrayBufferView");
    return toUint8Array(value);
  },
  decode(data: Uint8Array): Uint8Array {
    return data;
  },
};

/** Built-in JSON encoder. */
const jsonEncoder: Encoder = {
  encode(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value));
  },
  decode(data: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(data));
  },
};

/** Built-in CBOR encoder (default). */
const cborEncoder: Encoder = {
  encode: _encode,
  decode: _decode,
};

export const defaultCodex: Codex = {
  cbor: cborEncoder,
  json: jsonEncoder,
  binary: binaryEncoder,
};

export interface Frame {
  id: string;
  head?: Record<string, unknown>;
  data?: unknown;
  /** Original encoded data segment, when decoding an inbound frame. */
  raw?: Uint8Array;
}

// ── Varint helpers ───────────────────────────────────────────────────────────

function writeVarint(buf: Uint8Array, pos: number, val: number): number {
  if (!Number.isSafeInteger(val) || val < 0) {
    throw new RangeError("varint value must be a non-negative safe integer");
  }

  do {
    if (pos >= buf.length) throw new RangeError("frame buffer is too small");
    const byte = val % 0x80;
    val = Math.floor(val / 0x80);
    buf[pos++] = val > 0 ? byte | 0x80 : byte;
  } while (val > 0);

  return pos;
}

function readVarint(buf: Uint8Array, c: { v: number }): number {
  let value = 0;
  let multiplier = 1;

  // Eight 7-bit groups are enough for every safe integer that can be
  // represented by this codec.  More importantly, this prevents an
  // unterminated varint from scanning arbitrary memory or looping forever.
  for (let i = 0; i < 8; i++) {
    if (c.v >= buf.length) throw new RangeError("truncated frame varint");
    const byte = buf[c.v++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new RangeError("frame varint exceeds safe integer range");
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
  }

  throw new RangeError("frame varint is too long");
}

function varintLength(val: number): number {
  if (!Number.isSafeInteger(val) || val < 0) {
    throw new RangeError("varint value must be a non-negative safe integer");
  }

  let length = 1;
  while (val >= 0x80) {
    val = Math.floor(val / 0x80);
    length++;
  }
  return length;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface EncodedString {
  value: string;
  bytes?: Uint8Array;
  length: number;
}

function encodeStr(str: string): EncodedString {
  let ascii = true;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7f) {
      ascii = false;
      break;
    }
  }

  if (ascii) return { value: str, length: str.length };
  const bytes = utf8Encoder.encode(str);
  return { value: str, bytes, length: bytes.length };
}

function readStr(buf: Uint8Array, c: { v: number }): string {
  const len = readVarint(buf, c);
  if (len > buf.length - c.v) throw new RangeError("truncated frame string");
  const value = buf.subarray(c.v, c.v + len);
  c.v += len;
  try {
    return utf8Decoder.decode(value);
  } catch {
    throw new Error("frame id is not valid UTF-8");
  }
}

function isHeader(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wire frame encoder/decoder.
 *
 * Envelope wire format (3 varint-length-prefixed segments):
 *   [id utf8][head blob = cbor(head)][data blob = selectedEncoder.encode(data)]
 *
 * Head is always encoded with CBOR so the receiver can read `encoding` before
 * selecting the data decoder.  The data encoder is chosen from the codex via
 * `head.encoding`, defaulting to "cbor".
 *
 * Uses a per-instance pool buffer — encode() output is a subarray view valid
 * until the next encode() call on the same instance.
 */
export class FrameEncoder {
  private static readonly DEFAULT_POOL_SIZE = 4 * 1024 * 1024;
  /** No protocol size limit is imposed unless one is configured. */
  static readonly DEFAULT_MAX_FRAME_SIZE = Number.MAX_SAFE_INTEGER;

  private _pool: Uint8Array;
  readonly codex: Codex;
  readonly maxFrameSize: number;
  private _headEncoder: Encoder;

  constructor(codex: Codex = defaultCodex, options?: FrameEncoderOptions) {
    const maxFrameSize = options?.maxFrameSize ?? FrameEncoder.DEFAULT_MAX_FRAME_SIZE;
    if (!Number.isSafeInteger(maxFrameSize) || maxFrameSize <= 0) {
      throw new RangeError("maxFrameSize must be a positive safe integer");
    }

    this._pool = new Uint8Array(Math.min(FrameEncoder.DEFAULT_POOL_SIZE, maxFrameSize));
    this.codex = codex;
    this.maxFrameSize = maxFrameSize;
    /* Head is always CBOR so both sides can read encoding before selecting data codec */
    this._headEncoder = codex.cbor ?? cborEncoder;
  }

  private _getEncoder(encoding?: string): Encoder {
    if (!encoding) return this.codex.cbor ?? cborEncoder;
    const enc = this.codex[encoding];
    if (!enc) throw new Error(`unknown encoding: ${encoding}`);
    return enc;
  }

  /**
   * Encode into the reusable pool when possible.  The returned view retains
   * the historical lifetime contract and may be overwritten by the next
   * encode() call on this instance.  Oversized frames are returned in an
   * owned buffer instead of overflowing the pool.
   */
  encode(frame: Frame): Uint8Array {
    const encoded = this._prepare(frame);
    const target = encoded.length <= this._pool.length
      ? this._pool
      : new Uint8Array(encoded.length);
    return this._write(encoded, target);
  }

  /**
   * Encode into an owned buffer.  This is used at asynchronous wire
   * boundaries so a pooled encode never has to be copied a second time.
   * Binary payloads are copied directly into the final frame exactly once.
   */
  encodeOwned(frame: Frame): Uint8Array {
    const encoded = this._prepare(frame);
    return this._write(encoded, new Uint8Array(encoded.length));
  }

  decode(buf: Uint8Array): Frame {
    if (buf.byteLength > this.maxFrameSize) {
      throw new RangeError(`frame exceeds maximum size of ${this.maxFrameSize} bytes`);
    }

    const c = { v: 0 };
    const id = readStr(buf, c);

    const headLen = readVarint(buf, c);
    if (headLen > buf.length - c.v) throw new RangeError("truncated frame head");
    const decodedHead = headLen > 0
      ? this._headEncoder.decode(buf.subarray(c.v, c.v += headLen))
      : undefined;
    if (decodedHead !== undefined && !isHeader(decodedHead)) {
      throw new Error("frame head must decode to an object");
    }
    let head: Record<string, unknown> | undefined = decodedHead;

    const dataLen = readVarint(buf, c);
    if (dataLen > buf.length - c.v) throw new RangeError("truncated frame data");
    const encoding = head?.encoding as string | undefined;
    if (head?.encoding !== undefined && typeof head.encoding !== "string") {
      throw new Error("frame encoding must be a string");
    }
    const data = dataLen > 0
      ? this._getEncoder(encoding).decode(buf.subarray(c.v, c.v += dataLen))
      : undefined;
    const raw = dataLen > 0 ? buf.subarray(c.v - dataLen, c.v) : undefined;

    if (c.v !== buf.length) throw new Error("trailing bytes after frame");

    const frame: Frame = { id, head, data };
    if (raw !== undefined) {
      // Keep the historical enumerable shape of decoded frames while making
      // the raw segment available to callers that need it.
      Object.defineProperty(frame, "raw", { value: raw, enumerable: false });
    }
    return frame;
  }

  private _prepare(frame: Frame): {
    id: EncodedString;
    head?: Uint8Array;
    data?: Uint8Array;
    length: number;
  } {
    if (typeof frame.id !== "string") throw new TypeError("frame id must be a string");
    if (frame.head !== undefined && !isHeader(frame.head)) {
      throw new TypeError("frame head must be an object");
    }
    if (frame.head?.encoding !== undefined && typeof frame.head.encoding !== "string") {
      throw new TypeError("frame encoding must be a string");
    }

    const id = encodeStr(frame.id);
    const head = frame.head && Object.keys(frame.head).length > 0
      ? this._headEncoder.encode(frame.head)
      : undefined;

    let data: Uint8Array | undefined;
    if (frame.data !== undefined) {
      const encoding = frame.head?.encoding as string | undefined;
      const encoder = this._getEncoder(encoding);
      data = encoding === "binary"
        && encoder === binaryEncoder
        && isArrayBufferLike(frame.data)
        ? toUint8Array(frame.data)
        : encoder.encode(frame.data);
    }

    const headLength = head?.length ?? 0;
    const dataLength = data?.length ?? 0;
    const length = varintLength(id.length) + id.length
      + varintLength(headLength) + headLength
      + varintLength(dataLength) + dataLength;

    if (!Number.isSafeInteger(length) || length > this.maxFrameSize) {
      throw new RangeError(`frame exceeds maximum size of ${this.maxFrameSize} bytes`);
    }

    return { id, head, data, length };
  }

  private _write(encoded: {
    id: EncodedString;
    head?: Uint8Array;
    data?: Uint8Array;
    length: number;
  }, target: Uint8Array): Uint8Array {
    let pos = 0;
    pos = writeVarint(target, pos, encoded.id.length);
    if (encoded.id.bytes) {
      target.set(encoded.id.bytes, pos);
    } else {
      for (let i = 0; i < encoded.id.value.length; i++) {
        target[pos + i] = encoded.id.value.charCodeAt(i);
      }
    }
    pos += encoded.id.length;

    const head = encoded.head;
    pos = writeVarint(target, pos, head?.length ?? 0);
    if (head) {
      target.set(head, pos);
      pos += head.length;
    }

    const data = encoded.data;
    pos = writeVarint(target, pos, data?.length ?? 0);
    if (data) {
      target.set(data, pos);
      pos += data.length;
    }

    if (pos !== encoded.length) throw new Error("internal frame length mismatch");
    return target.subarray(0, pos);
  }
}

// ── Default instance (bare cbor-x, stateless) ────────────────────────────────

const _defaultEncoder = new FrameEncoder();

export function encodeFrame(frame: Frame): Uint8Array {
  return _defaultEncoder.encode(frame);
}

export function decodeFrame(data: Uint8Array): Frame {
  return _defaultEncoder.decode(data);
}

/** Encode a single value using the default CBOR encoder. */
export function encodeData(value: unknown): Uint8Array {
  return cborEncoder.encode(value);
}

/** Decode a single value using the default CBOR encoder. */
export function decodeData(raw: Uint8Array): unknown {
  return cborEncoder.decode(raw);
}
