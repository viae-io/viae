import { encode as _encode, decode as _decode } from "cbor-x";

export interface Encoder {
  encode(value: unknown): Uint8Array;
  decode(data: Uint8Array): unknown;
}

/**
 * A Codex is a registry of named encoders.
 * The FrameEncoder consults `head.encoding` to pick the right one.
 */
export interface Codex {
  [name: string]: Encoder;
}

function isArrayBufferLike(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}

function toUint8Array(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return new Uint8Array(v);
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
}

// ── Varint helpers ───────────────────────────────────────────────────────────

function writeVarint(buf: Uint8Array, pos: number, val: number): number {
  while (val > 0x7f) { buf[pos++] = (val & 0x7f) | 0x80; val >>>= 7; }
  buf[pos++] = val;
  return pos;
}

function readVarint(buf: Uint8Array, c: { v: number }): number {
  let r = 0, s = 0, b: number;
  do { b = buf[c.v++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
  return r;
}

function writeStr(buf: Uint8Array, pos: number, str: string): number {
  pos = writeVarint(buf, pos, str.length);
  for (let i = 0; i < str.length; i++) buf[pos++] = str.charCodeAt(i);
  return pos;
}

function readStr(buf: Uint8Array, c: { v: number }): string {
  const len = readVarint(buf, c);
  let s = '';
  const end = c.v + len;
  for (; c.v < end; c.v++) s += String.fromCharCode(buf[c.v]);
  return s;
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
  private _pool = new Uint8Array(4 * 1024 * 1024);
  readonly codex: Codex;
  private _headEncoder: Encoder;

  constructor(codex: Codex = defaultCodex) {
    this.codex = codex;
    /* Head is always CBOR so both sides can read encoding before selecting data codec */
    this._headEncoder = codex.cbor ?? cborEncoder;
  }

  private _getEncoder(encoding?: string): Encoder {
    if (!encoding) return this.codex.cbor ?? cborEncoder;
    const enc = this.codex[encoding];
    if (!enc) throw new Error(`unknown encoding: ${encoding}`);
    return enc;
  }

  encode(frame: Frame): Uint8Array {
    let pos = writeStr(this._pool, 0, frame.id);

    const encoding = frame.head?.encoding as string | undefined;

    if (frame.head && Object.keys(frame.head).length > 0) {
      const headBytes = this._headEncoder.encode(frame.head);
      pos = writeVarint(this._pool, pos, headBytes.length);
      this._pool.set(headBytes, pos);
      pos += headBytes.length;
    } else {
      pos = writeVarint(this._pool, pos, 0);
    }

    if (frame.data !== undefined) {
      const encoder = this._getEncoder(encoding);
      const dataBytes = encoder.encode(frame.data);
      pos = writeVarint(this._pool, pos, dataBytes.length);
      this._pool.set(dataBytes, pos);
      pos += dataBytes.length;
    } else {
      pos = writeVarint(this._pool, pos, 0);
    }

    return this._pool.subarray(0, pos);
  }

  decode(buf: Uint8Array): Frame {
    const c = { v: 0 };
    const id = readStr(buf, c);

    const headLen = readVarint(buf, c);
    const head = headLen > 0
      ? this._headEncoder.decode(buf.subarray(c.v, c.v += headLen)) as Record<string, unknown>
      : undefined;

    const encoding = head?.encoding as string | undefined;

    const dataLen = readVarint(buf, c);
    const data = dataLen > 0
      ? this._getEncoder(encoding).decode(buf.subarray(c.v, c.v += dataLen))
      : undefined;

    return { id, head, data };
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
