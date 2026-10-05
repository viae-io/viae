import { encode as _encode, decode as _decode, setSizeLimits } from "cbor-x";

// cbor-x 1.6.3 exports setSizeLimits at runtime (decode.js) but omits it from
// its bundled typings, so declare it here to keep the build type-clean.
declare module "cbor-x" {
  export function setSizeLimits(limits: {
    maxArraySize?: number;
    maxMapSize?: number;
    maxObjectSize?: number;
  }): void;
}

// cbor-x size limits are process-global state, so cap them once at module
// load.  Without limits, a tiny frame can request an enormous allocation: a
// 5-byte data segment such as `9a 00 1e 84 80` (CBOR array-32 claiming
// 2,000,000 elements, truncated) drives the decoder into a ~256 MB
// allocation before any payload bytes are read.  These caps are far above
// any legitimate viae payload and reject such amplification frames instead.
// Note: this affects every cbor-x consumer in the process.
setSizeLimits({ maxArraySize: 1_000_000, maxMapSize: 100_000, maxObjectSize: 100_000 });

export interface Encoder {
  encode(value: unknown): Uint8Array;
  decode(data: Uint8Array): unknown;
}

export interface FrameEncoderOptions {
  /** Maximum encoded frame size accepted by encode() and decode(). */
  maxFrameSize?: number;
  /**
   * Protocol major version.  Defaults to `1`.  When positive, non-empty
   * heads that omit a `v` field get one injected (into a copy; the caller's
   * head is never mutated) and decoded heads carrying a `v` must match this
   * value.  `0` disables both emission and validation.
   */
  protocolVersion?: number;
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

// Module-level singletons so the JSON codec does not allocate a TextEncoder /
// TextDecoder per call.
const jsonTextEncoder = new TextEncoder();
const jsonTextDecoder = new TextDecoder();

/** Built-in JSON encoder. */
const jsonEncoder: Encoder = {
  encode(value: unknown): Uint8Array {
    return jsonTextEncoder.encode(JSON.stringify(value));
  },
  decode(data: Uint8Array): unknown {
    return JSON.parse(jsonTextDecoder.decode(data));
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
  const start = c.v;
  c.v += len;

  // ASCII fast path: ids and header keys are overwhelmingly ASCII, and a
  // charCode loop avoids both the TextDecoder setup and its allocation.
  let ascii = true;
  for (let i = start; i < start + len; i++) {
    if (buf[i] >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    let str = "";
    for (let i = start; i < start + len; i++) str += String.fromCharCode(buf[i]);
    return str;
  }

  try {
    return utf8Decoder.decode(buf.subarray(start, start + len));
  } catch {
    throw new Error("frame id is not valid UTF-8");
  }
}

function isHeader(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when `o` has at least one own enumerable key.  Cheaper than
 * `Object.keys(o).length > 0`, which allocates a key array.
 */
function hasOwnKeys(o: Record<string, unknown>): boolean {
  for (const k in o) {
    if (Object.hasOwn(o, k)) return true;
  }
  return false;
}

/** Reused descriptor so decode() does not allocate one per frame. */
const rawPropertyDescriptor: PropertyDescriptor = { enumerable: false };

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
 * Uses a per-instance pool buffer, allocated lazily on the first encode() —
 * encode() output is a subarray view valid until the next encode() call on
 * the same instance.
 */
export class FrameEncoder {
  private static readonly DEFAULT_POOL_SIZE = 4 * 1024 * 1024;
  /**
   * Default maximum accepted frame size: 64 MiB.  This is defense in depth
   * against oversized frames; opt out with
   * `new FrameEncoder(codex, { maxFrameSize: Number.MAX_SAFE_INTEGER })`.
   */
  static readonly DEFAULT_MAX_FRAME_SIZE = 64 * 1024 * 1024;

  private _pool?: Uint8Array;
  readonly codex: Codex;
  readonly maxFrameSize: number;
  /** Protocol major version emitted/validated on frame heads; `0` disables both. */
  readonly protocolVersion: number;
  private _headEncoder: Encoder;

  constructor(codex: Codex = defaultCodex, options?: FrameEncoderOptions) {
    const maxFrameSize = options?.maxFrameSize ?? FrameEncoder.DEFAULT_MAX_FRAME_SIZE;
    if (!Number.isSafeInteger(maxFrameSize) || maxFrameSize <= 0) {
      throw new RangeError("maxFrameSize must be a positive safe integer");
    }
    const protocolVersion = options?.protocolVersion ?? 1;
    if (!Number.isSafeInteger(protocolVersion) || protocolVersion < 0) {
      throw new RangeError("protocolVersion must be 0 or a positive safe integer");
    }

    this.codex = codex;
    this.maxFrameSize = maxFrameSize;
    this.protocolVersion = protocolVersion;
    /* Head is always CBOR so both sides can read encoding before selecting data codec */
    this._headEncoder = codex.cbor ?? cborEncoder;
  }

  private _getEncoder(encoding?: string): Encoder {
    if (!encoding) return this.codex.cbor ?? cborEncoder;
    // Reject prototype-chain members ("constructor", "toString", ...) so a
    // remote-controlled head.encoding cannot select an inherited property as
    // an encoder; only own codex entries are valid.
    if (!Object.hasOwn(this.codex, encoding)) {
      throw new Error(`unknown encoding: ${encoding}`);
    }
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
    const pool = this._pool
      ?? (this._pool = new Uint8Array(Math.min(FrameEncoder.DEFAULT_POOL_SIZE, this.maxFrameSize)));
    const target = encoded.length <= pool.length
      ? pool
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

    if (this.protocolVersion > 0 && head?.v !== undefined) {
      if (typeof head.v !== "number" || head.v !== this.protocolVersion) {
        throw new Error(`unsupported protocol version: ${String(head.v)}`);
      }
    }

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
      rawPropertyDescriptor.value = raw;
      Object.defineProperty(frame, "raw", rawPropertyDescriptor);
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
    let head: Uint8Array | undefined;
    if (frame.head && hasOwnKeys(frame.head)) {
      // Inject the protocol major into a copy; never mutate the caller's head.
      const headToEncode = this.protocolVersion > 0 && frame.head.v === undefined
        ? { ...frame.head, v: this.protocolVersion }
        : frame.head;
      head = this._headEncoder.encode(headToEncode);
    }

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
