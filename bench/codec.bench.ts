/**
 * Codec Benchmark: cbor-x (Encoder, useRecords:true) vs native binary + cbor-x
 *
 * Both approaches use the same cbor-x Encoder instance for data payloads.
 * The only difference is how the frame envelope is serialised:
 *
 *   cbor-x      — single CBOR blob for the entire frame (envelope + data)
 *                 useRecords:true: repeated object shapes share a schema
 *
 *   native+cbor — hand-coded varint/length-prefix binary frame encoding
 *                 cbor-x Encoder encodes the data payload (stored in raw)
 *                 nativeEncode returns a pool subarray — zero allocation
 *
 * This isolates the frame-encoding approach from the data-encoding approach.
 *
 * Note: head values are map<string,string> so numeric header fields (e.g. status)
 * must be stringified — comparable to the original behaviour.
 *
 * Metrics: ops/s and bytes per message.
 */

import { Encoder as CborEncoder } from "cbor-x";

const cbor = new CborEncoder({ useRecords: true, structuredClone: false });

// ─── Scenarios ─────────────────────────────────────────────────────────────

/**
 * CborFrame: head values are typed — cbor-x encodes the entire frame
 * including nested data in one pass. decode() gives it all back directly.
 */
interface CborFrame {
  i: string;
  h?: Record<string, unknown>;
  d?: unknown;
}

/**
 * NativeFrame: head values are strings (map<string,string>).
 * nativeEncode calls cbor.encode(data) internally for the payload.
 * nativeDecode reads the envelope then calls cbor.decode(raw) for the payload.
 * Both paths do the same total work.
 */
interface NativeFrame {
  id: string;
  head: Record<string, string>;
  data?: unknown;
}

const scenarios: {
  name: string;
  cbor: CborFrame;
  native: NativeFrame;
}[] = [
  {
    name: "header-only (request)  ",
    cbor: { i: "a1b2c3d4", h: { method: "GET", path: "/api/v1/users/42" } },
    native: { id: "a1b2c3d4", head: { method: "GET", path: "/api/v1/users/42" } },
  },
  {
    name: "header-only (response) ",
    cbor: { i: "a1b2c3d4", h: { status: 200, sid: "s9z8y7" } },
    native: { id: "a1b2c3d4", head: { status: "200", sid: "s9z8y7" } },
  },
  {
    name: "small payload          ",
    cbor: makeWithPayload({ id: 42, name: "Alice", role: "admin" }),
    native: makeNativeWithPayload({ id: 42, name: "Alice", role: "admin" }),
  },
  {
    name: "medium payload         ",
    cbor: makeWithPayload(
      Array.from({ length: 20 }, (_, i) => ({
        id: i,
        value: Math.random(),
        label: `item-${i}`,
        tags: ["a", "b", "c"],
      }))
    ),
    native: makeNativeWithPayload(
      Array.from({ length: 20 }, (_, i) => ({
        id: i,
        value: Math.random(),
        label: `item-${i}`,
        tags: ["a", "b", "c"],
      }))
    ),
  },
  {
    name: "large payload          ",
    cbor: makeWithPayload(
      Array.from({ length: 200 }, (_, i) => ({
        id: i,
        value: Math.random(),
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        tags: ["alpha", "beta", "gamma", "delta"],
        nested: { x: i * 1.5, y: i * 2.5, active: i % 2 === 0 },
      }))
    ),
    native: makeNativeWithPayload(
      Array.from({ length: 200 }, (_, i) => ({
        id: i,
        value: Math.random(),
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        tags: ["alpha", "beta", "gamma", "delta"],
        nested: { x: i * 1.5, y: i * 2.5, active: i % 2 === 0 },
      }))
    ),
  },
];

function makeWithPayload(data: unknown): CborFrame {
  return { i: "a1b2c3d4", h: { status: 206 }, d: data };
}

function makeNativeWithPayload(data: unknown): NativeFrame {
  return { id: "a1b2c3d4", head: { status: "206" }, data };
}

// ─── Native binary codec helpers ────────────────────────────────────────────
// Hand-coded varint + length-prefixed binary frame encoder.
// All strings assumed ASCII (method names, paths, UUIDs, status codes).
// nativeEncode returns a pool subarray — no copy needed.

const pool = new Uint8Array(4 * 1024 * 1024);

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

function nativeEncode(frame: NativeFrame): Uint8Array {
  let pos = writeStr(pool, 0, frame.id);
  const entries = Object.entries(frame.head);
  pos = writeVarint(pool, pos, entries.length);
  for (const [k, v] of entries) {
    pos = writeStr(pool, pos, k);
    pos = writeStr(pool, pos, v);
  }
  if (frame.data !== undefined) {
    const raw = cbor.encode(frame.data);
    pos = writeVarint(pool, pos, raw.length);
    pool.set(raw, pos);
    pos += raw.length;
  } else {
    pos = writeVarint(pool, pos, 0);
  }
  return pool.subarray(0, pos);
}

function nativeDecode(buf: Uint8Array): NativeFrame {
  const c = { v: 0 };
  const id = readStr(buf, c);
  const headCount = readVarint(buf, c);
  const head: Record<string, string> = {};
  for (let i = 0; i < headCount; i++) {
    const k = readStr(buf, c);
    head[k] = readStr(buf, c);
  }
  const rawLen = readVarint(buf, c);
  let data: unknown;
  if (rawLen > 0) {
    data = cbor.decode(buf.subarray(c.v, c.v + rawLen));
    c.v += rawLen;
  }
  return { id, head, data };
}

// ─── Benchmark runner ───────────────────────────────────────────────────────

const WARMUP = 5_000;
const ITERATIONS = 50_000;

function bench(label: string, fn: () => void): { ops: number; ns: number } {
  // warmup
  for (let i = 0; i < WARMUP; i++) fn();

  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) fn();
  const end = process.hrtime.bigint();

  const totalNs = Number(end - start);
  const nsPerOp = totalNs / ITERATIONS;
  const ops = 1e9 / nsPerOp;
  return { ops, ns: nsPerOp };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ops/s`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ops/s`;
  return `${n.toFixed(0)} ops/s`;
}

// ─── Run ────────────────────────────────────────────────────────────────────

const W = 72;
const sep = "─".repeat(W);

console.log(`\n${"═".repeat(W)}`);
console.log(`  Codec Benchmark  —  cbor-x (Encoder, useRecords:true)  vs  native binary + cbor-x`);
console.log(`  ${ITERATIONS.toLocaleString()} iterations  |  Node ${process.version}`);
console.log(`${"═".repeat(W)}\n`);

const col = (s: string, w: number, right = false) =>
  right ? s.padStart(w) : s.padEnd(w);

console.log(
  col("Scenario", 24) +
  col("Op", 11) +
  col("cbor-x (records)", 14, true) +
  col("native+cbor", 14, true) +
  col("Δ", 9, true)
);
console.log(sep);

for (const sc of scenarios) {
  // ── encode ──────────────────────────────────────
  let cborEncoded!: Uint8Array;
  let nativeEncoded!: Uint8Array;

  const cborEnc = bench("cbor enc", () => { cborEncoded = cbor.encode(sc.cbor); });
  const nativeEnc = bench("native enc", () => { nativeEncoded = nativeEncode(sc.native); });

  nativeEncoded = nativeEncode(sc.native);  // cbor's internal buffer now has payload bytes
  cborEncoded = cbor.encode(sc.cbor);       // last write to cbor buffer — stays valid for decode bench

  // ── decode ──────────────────────────────────────
  const cborDec = bench("cbor dec", () => { cbor.decode(cborEncoded); });
  const nativeDec = bench("native dec", () => { nativeDecode(nativeEncoded); });

  // ── roundtrip ────────────────────────────────────
  const cborRT = bench("cbor rt", () => { cbor.decode(cbor.encode(sc.cbor)); });
  const nativeRT = bench("native rt", () => { nativeDecode(nativeEncode(sc.native)); });

  const ratio = (a: number, b: number) => {
    const r = a / b;
    return r >= 1 ? `+${((r - 1) * 100).toFixed(0)}%` : `-${((1 - r) * 100).toFixed(0)}%`;
  };

  const winner = (a: number, b: number) => a > b ? "cbor-x" : "native";

  console.log(
    col(sc.name.trim(), 24) +
    col("encode", 11) +
    col(fmt(cborEnc.ops), 14, true) +
    col(fmt(nativeEnc.ops), 14, true) +
    col(`${winner(cborEnc.ops, nativeEnc.ops)} ${ratio(cborEnc.ops, nativeEnc.ops)}`, 9, true)
  );
  console.log(
    col("", 24) +
    col("decode", 11) +
    col(fmt(cborDec.ops), 14, true) +
    col(fmt(nativeDec.ops), 14, true) +
    col(`${winner(cborDec.ops, nativeDec.ops)} ${ratio(cborDec.ops, nativeDec.ops)}`, 9, true)
  );
  console.log(
    col("", 24) +
    col("roundtrip", 11) +
    col(fmt(cborRT.ops), 14, true) +
    col(fmt(nativeRT.ops), 14, true) +
    col(`${winner(cborRT.ops, nativeRT.ops)} ${ratio(cborRT.ops, nativeRT.ops)}`, 9, true)
  );
  console.log(
    col("", 24) +
    col("bytes", 11) +
    col(`${cborEncoded.byteLength} B`, 14, true) +
    col(`${nativeEncoded.byteLength} B`, 14, true) +
    col(cborEncoded.byteLength <= nativeEncoded.byteLength ? "cbor-x ✓" : "native ✓", 9, true)
  );
  console.log(sep);
}

console.log();
