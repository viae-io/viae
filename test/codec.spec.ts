import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameEncoder, type Frame, defaultCodex, type Encoder, encodeData } from "../src/codec.js";

/**
 * Build a deterministic object payload of approximately `targetBytes` in size.
 * Uses repeated string entries to reach the target.
 */
function makePayload(targetBytes: number): Record<string, unknown> {
  // Each entry is ~100 bytes when CBOR-encoded; adjust count accordingly.
  const entrySize = 100;
  const count = Math.max(1, Math.ceil(targetBytes / entrySize));
  const items = Array.from({ length: count }, (_, i) => ({
    id: i,
    value: (i * 3.14).toFixed(4),
    label: `item-${String(i).padStart(6, "0")}`,
    tag: "abcdefghijklmnopqrstuvwxyz".slice(0, 20),
    active: i % 2 === 0,
  }));
  return { items };
}

function makeStringPayload(targetBytes: number): string {
  const ch = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  while (s.length < targetBytes) s += ch;
  return s.slice(0, targetBytes);
}

const KB = 1024;

const sizes = [
  { label: "1 KB", bytes: 1 * KB },
  { label: "2 KB", bytes: 2 * KB },
  { label: "4 KB", bytes: 4 * KB },
  { label: "8 KB", bytes: 8 * KB },
  { label: "16 KB", bytes: 16 * KB },
];

describe("FrameEncoder", () => {
  describe("basic round-trip", () => {
    const encoder = new FrameEncoder();

    it("should encode and decode a frame with no head or data", () => {
      const frame: Frame = { id: "abc123" };
      const buf = Uint8Array.from(encoder.encode(frame));
      assert.deepEqual(buf, Uint8Array.from([6, 97, 98, 99, 49, 50, 51, 0, 0]));
      const decoded = encoder.decode(buf);
      assert.equal(decoded.id, "abc123");
      assert.equal(decoded.head, undefined);
      assert.equal(decoded.data, undefined);
    });

    it("should retain the golden request frame encoding", () => {
      const bytes = Uint8Array.from(encoder.encode({
        id: "req-1",
        head: { method: "GET", path: "/ping" },
      }));
      assert.deepEqual(bytes, Uint8Array.from([
        5, 114, 101, 113, 45, 49, 28, 185, 0, 3, 102, 109, 101, 116, 104,
        111, 100, 99, 71, 69, 84, 100, 112, 97, 116, 104, 101, 47, 112, 105,
        110, 103, 97, 118, 1, 0,
      ]));
    });

    it("should encode and decode a frame with head only", () => {
      const frame: Frame = { id: "h1", head: { method: "GET", path: "/test" } };
      const buf = Uint8Array.from(encoder.encode(frame));
      const decoded = encoder.decode(buf);
      assert.equal(decoded.id, "h1");
      assert.deepEqual(decoded.head, { method: "GET", path: "/test", v: 1 });
      assert.equal(decoded.data, undefined);
    });

    it("should encode and decode a frame with data only", () => {
      const frame: Frame = { id: "d1", data: { hello: "world" } };
      const buf = Uint8Array.from(encoder.encode(frame));
      const decoded = encoder.decode(buf);
      assert.equal(decoded.id, "d1");
      assert.deepEqual(decoded.data, { hello: "world" });
    });

    it("should encode and decode a frame with head and data", () => {
      const frame: Frame = {
        id: "full",
        head: { status: 200, encoding: "cbor" },
        data: [1, 2, 3],
      };
      const buf = Uint8Array.from(encoder.encode(frame));
      const decoded = encoder.decode(buf);
      assert.equal(decoded.id, "full");
      assert.deepEqual(decoded.head, { status: 200, encoding: "cbor", v: 1 });
      assert.deepEqual(decoded.data, [1, 2, 3]);
    });
  });

  describe("json encoding round-trip", () => {
    const encoder = new FrameEncoder();

    it("should round-trip using json encoding", () => {
      const frame: Frame = {
        id: "json1",
        head: { encoding: "json" },
        data: { key: "value", num: 42 },
      };
      const buf = Uint8Array.from(encoder.encode(frame));
      const decoded = encoder.decode(buf);
      assert.equal(decoded.id, "json1");
      assert.deepEqual(decoded.data, { key: "value", num: 42 });
    });
  });

  describe("binary encoding round-trip", () => {
    const encoder = new FrameEncoder();

    it("should round-trip binary data", () => {
      const payload = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
      const frame: Frame = {
        id: "bin1",
        head: { encoding: "binary" },
        data: payload,
      };
      const buf = Uint8Array.from(encoder.encode(frame));
      const decoded = encoder.decode(buf);
      assert.deepEqual(new Uint8Array(decoded.data as ArrayBuffer), payload);
    });

    it("should preserve the existing absent-data representation for empty binary data", () => {
      const frame: Frame = {
        id: "empty-bin",
        head: { encoding: "binary" },
        data: new Uint8Array(0),
      };
      const decoded = encoder.decode(Uint8Array.from(encoder.encode(frame)));
      assert.equal(decoded.data, undefined);
    });
  });

  describe("frame validation and ownership", () => {
    const encoder = new FrameEncoder();

    it("should round-trip UTF-8 ids", () => {
      const frame: Frame = { id: "stream-😀-é", head: { status: 200 } };
      const decoded = encoder.decode(Uint8Array.from(encoder.encode(frame)));
      assert.equal(decoded.id, frame.id);
    });

    it("should expose the raw encoded data segment on decode", () => {
      const bytes = Uint8Array.from(encoder.encode({ id: "raw", head: { encoding: "binary" }, data: Uint8Array.from([1, 2, 3]) }));
      const decoded = encoder.decode(bytes);
      assert.deepEqual(decoded.raw, Uint8Array.from([1, 2, 3]));
    });

    it("should reject truncated and trailing frames", () => {
      const bytes = Uint8Array.from(encoder.encode({ id: "x", head: { status: 200 } }));
      assert.throws(() => encoder.decode(bytes.slice(0, -1)), /truncated|CBOR/);
      assert.throws(() => encoder.decode(Uint8Array.from([...bytes, 0])), /trailing/);
    });

    it("should reject unterminated length varints", () => {
      assert.throws(() => encoder.decode(Uint8Array.from([0x80])), /truncated|too long/);
    });

    it("should enforce a configured maximum frame size", () => {
      const limited = new FrameEncoder(defaultCodex, { maxFrameSize: 32 });
      assert.throws(
        () => limited.encode({ id: "large", data: new Uint8Array(64), head: { encoding: "binary" } }),
        /maximum size/,
      );
      const bytes = Uint8Array.from(encoder.encode({ id: "large", data: new Uint8Array(64), head: { encoding: "binary" } }));
      assert.throws(() => limited.decode(bytes), /maximum size/);
    });

    it("should encode oversized binary frames without overflowing the pool", () => {
      const payload = new Uint8Array(4 * 1024 * 1024);
      const bytes = encoder.encode({ id: "large", head: { encoding: "binary" }, data: payload });
      const decoded = encoder.decode(bytes);
      assert.equal((decoded.data as Uint8Array).byteLength, payload.byteLength);
    });

    it("should provide an owned encoding result", () => {
      const first = encoder.encodeOwned({ id: "one", data: { n: 1 } });
      const copy = Uint8Array.from(first);
      encoder.encodeOwned({ id: "two", data: { n: 2 } });
      assert.deepEqual(encoder.decode(copy).data, { n: 1 });
    });
  });

  describe("increasing object payload sizes (CBOR)", () => {
    const encoder = new FrameEncoder();

    for (const { label, bytes } of sizes) {
      it(`should round-trip ~${label} object payload`, () => {
        const payload = makePayload(bytes);
        const frame: Frame = {
          id: `obj-${bytes}`,
          head: { method: "POST", path: "/upload" },
          data: payload,
        };

        const encoded = Uint8Array.from(encoder.encode(frame));
        const decoded = encoder.decode(encoded);

        assert.equal(decoded.id, frame.id);
        assert.deepEqual(decoded.head, { ...frame.head, v: 1 });
        assert.deepEqual(decoded.data, payload);
      });
    }
  });

  describe("increasing string payload sizes (CBOR)", () => {
    const encoder = new FrameEncoder();

    for (const { label, bytes } of sizes) {
      it(`should round-trip ~${label} string payload`, () => {
        const payload = makeStringPayload(bytes);
        const frame: Frame = {
          id: `str-${bytes}`,
          head: { method: "PUT", path: "/data" },
          data: payload,
        };

        const encoded = Uint8Array.from(encoder.encode(frame));
        const decoded = encoder.decode(encoded);

        assert.equal(decoded.id, frame.id);
        assert.deepEqual(decoded.head, { ...frame.head, v: 1 });
        assert.equal(decoded.data, payload);
      });
    }
  });

  describe("increasing binary payload sizes", () => {
    const encoder = new FrameEncoder();

    for (const { label, bytes } of sizes) {
      it(`should round-trip ~${label} binary payload`, () => {
        const payload = new Uint8Array(bytes);
        for (let i = 0; i < bytes; i++) payload[i] = i & 0xff;

        const frame: Frame = {
          id: `bin-${bytes}`,
          head: { encoding: "binary" },
          data: payload,
        };

        const encoded = Uint8Array.from(encoder.encode(frame));
        const decoded = encoder.decode(encoded);

        assert.equal(decoded.id, frame.id);
        const result = new Uint8Array(decoded.data as ArrayBuffer);
        assert.equal(result.length, bytes);
        assert.deepEqual(result, payload);
      });
    }
  });

  describe("increasing JSON-encoded payload sizes", () => {
    const encoder = new FrameEncoder();

    for (const { label, bytes } of sizes) {
      it(`should round-trip ~${label} JSON payload`, () => {
        const payload = makePayload(bytes);
        const frame: Frame = {
          id: `json-${bytes}`,
          head: { encoding: "json", method: "POST", path: "/submit" },
          data: payload,
        };

        const encoded = Uint8Array.from(encoder.encode(frame));
        const decoded = encoder.decode(encoded);

        assert.equal(decoded.id, frame.id);
        assert.deepEqual(decoded.data, payload);
      });
    }
  });

  describe("hardening (D1/D2)", () => {
    const encoder = new FrameEncoder();

    it("should reject a 5-byte data segment claiming a 2,000,000-element CBOR array", () => {
      // id "amp", no head, data len 5, data = 9a 00 1e 84 80:
      // CBOR array-32 header claiming 2,000,000 elements, truncated.  Without
      // cbor-x size limits this would request a ~256 MB allocation.
      const bytes = Uint8Array.from([3, 0x61, 0x6d, 0x70, 0, 5, 0x9a, 0x00, 0x1e, 0x84, 0x80]);
      assert.throws(() => encoder.decode(bytes), /Array length exceeds/);
    });

    it("should still round-trip normal arrays and objects under the cbor size limits", () => {
      const arr = Array.from({ length: 10_000 }, (_, i) => i);
      const obj = Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`k${i}`, i]));

      const decodedArr = encoder.decode(Uint8Array.from(encoder.encode({ id: "arr", data: arr })));
      assert.deepEqual(decodedArr.data, arr);

      const decodedObj = encoder.decode(Uint8Array.from(encoder.encode({ id: "obj", data: obj })));
      assert.deepEqual(decodedObj.data, obj);
    });

    it("should pin the default maximum frame size at 64 MiB", () => {
      assert.equal(FrameEncoder.DEFAULT_MAX_FRAME_SIZE, 64 * 1024 * 1024);
    });

    it("should reject a non-positive maxFrameSize", () => {
      assert.throws(
        () => new FrameEncoder(defaultCodex, { maxFrameSize: 0 }),
        RangeError,
      );
    });

    it("should encode an empty head as no head", () => {
      const withEmptyHead = Uint8Array.from(encoder.encode({ id: "empty-head", head: {} }));
      const withoutHead = Uint8Array.from(encoder.encode({ id: "empty-head" }));
      assert.deepEqual(withEmptyHead, withoutHead);
      assert.equal(encoder.decode(withEmptyHead).head, undefined);
    });
  });

  describe("protocol version (D6)", () => {
    const encoder = new FrameEncoder();

    it("should default to protocol version 1 and expose the configured value", () => {
      assert.equal(encoder.protocolVersion, 1);
      assert.equal(new FrameEncoder(defaultCodex, { protocolVersion: 0 }).protocolVersion, 0);
      assert.equal(new FrameEncoder(defaultCodex, { protocolVersion: 3 }).protocolVersion, 3);
    });

    it("should inject v into a copy without mutating the caller's head", () => {
      const head = { method: "GET", path: "/mutate-me" };
      const snapshot = { ...head };
      const decoded = encoder.decode(Uint8Array.from(encoder.encode({ id: "copy", head })));
      assert.equal(decoded.head?.v, 1);
      assert.deepEqual(head, snapshot);
      assert.equal(Object.hasOwn(head, "v"), false);
    });

    it("should not overwrite an explicitly supplied v", () => {
      const explicit1 = encoder.decode(Uint8Array.from(encoder.encode({ id: "e1", head: { v: 1, method: "GET" } })));
      assert.equal(explicit1.head?.v, 1);
      assert.equal(explicit1.head?.method, "GET");

      const version2 = new FrameEncoder(defaultCodex, { protocolVersion: 2 });
      const explicit2 = version2.decode(Uint8Array.from(version2.encode({ id: "e2", head: { v: 2 } })));
      assert.equal(explicit2.head?.v, 2);

      const injected2 = version2.decode(Uint8Array.from(version2.encode({ id: "e3", head: { method: "GET" } })));
      assert.equal(injected2.head?.v, 2);
    });

    it("should encode an empty head headless with no v", () => {
      const withEmptyHead = Uint8Array.from(encoder.encode({ id: "empty-v", head: {} }));
      const withoutHead = Uint8Array.from(encoder.encode({ id: "empty-v" }));
      assert.deepEqual(withEmptyHead, withoutHead);
      assert.equal(encoder.decode(withEmptyHead).head, undefined);
    });

    it("should neither emit nor validate v when protocolVersion is 0", () => {
      const disabled = new FrameEncoder(defaultCodex, { protocolVersion: 0 });
      const plain = disabled.decode(Uint8Array.from(disabled.encode({ id: "off", head: { method: "GET" } })));
      assert.equal(plain.head?.method, "GET");
      assert.equal(Object.hasOwn(plain.head ?? {}, "v"), false);

      // Any v value is accepted, including non-numbers.
      for (const anyV of [2, "x", null]) {
        const decoded = disabled.decode(Uint8Array.from(disabled.encode({ id: "off-any", head: { v: anyV } })));
        assert.equal(decoded.head?.v, anyV);
      }

      // Frames from a default (v: 1) peer are accepted too.
      const fromDefault = disabled.decode(Uint8Array.from(encoder.encode({ id: "off-peer", head: { method: "GET" } })));
      assert.equal(fromDefault.head?.v, 1);
    });

    it("should reject a mismatched protocol version on decode", () => {
      const disabled = new FrameEncoder(defaultCodex, { protocolVersion: 0 });
      const mismatched = Uint8Array.from(disabled.encode({ id: "bad", head: { v: 2 } }));
      assert.throws(() => encoder.decode(mismatched), /unsupported protocol version: 2/);

      const nonNumeric = Uint8Array.from(disabled.encode({ id: "bad-str", head: { v: "x" } }));
      assert.throws(() => encoder.decode(nonNumeric), /unsupported protocol version: x/);
    });

    it("should accept and retain legacy frames without v", () => {
      const disabled = new FrameEncoder(defaultCodex, { protocolVersion: 0 });
      const legacy = Uint8Array.from(disabled.encode({ id: "legacy", head: { method: "GET" } }));
      const decoded = encoder.decode(legacy);
      assert.equal(decoded.head?.method, "GET");
      assert.equal(Object.hasOwn(decoded.head ?? {}, "v"), false);
    });

    it("should reject invalid protocol versions in the constructor", () => {
      for (const bad of [-1, 1.5, NaN, Infinity]) {
        assert.throws(() => new FrameEncoder(defaultCodex, { protocolVersion: bad }), RangeError);
      }
    });
  });

  describe("prototype-chain codex lookup (AC3)", () => {
    const encoder = new FrameEncoder();

    it("should reject prototype-chain encoding names on decode with a clean error", () => {
      for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
        // Hand-build a frame: id "p", head blob = cbor({ encoding: name }),
        // 1-byte data segment [0x01].  head.length is < 0x80 so it is a
        // single-byte varint.
        const head = Uint8Array.from(encodeData({ encoding: name }));
        const bytes = Uint8Array.from([1, 0x70, head.length, ...head, 1, 0x01]);
        assert.throws(() => encoder.decode(bytes), new RegExp(`unknown encoding: ${name}`));
      }
    });

    it("should reject a prototype-chain encoding name on encode with a clean error", () => {
      assert.throws(
        () => encoder.encode({ id: "proto", head: { encoding: "constructor" }, data: { n: 1 } }),
        /unknown encoding: constructor/,
      );
    });

    it("should still resolve built-in and custom own codex entries", () => {
      const json = encoder.decode(Uint8Array.from(encoder.encode({ id: "j", head: { encoding: "json" }, data: { a: 1 } })));
      assert.deepEqual(json.data, { a: 1 });

      const bin = encoder.decode(Uint8Array.from(encoder.encode({ id: "bin", head: { encoding: "binary" }, data: Uint8Array.from([1, 2, 3]) })));
      assert.deepEqual(bin.data, Uint8Array.from([1, 2, 3]));

      const cbor = encoder.decode(Uint8Array.from(encoder.encode({ id: "c", data: [1, 2, 3] })));
      assert.deepEqual(cbor.data, [1, 2, 3]);

      const foo: Encoder = {
        encode: (value) => new TextEncoder().encode(String(value)),
        decode: (data) => new TextDecoder().decode(data),
      };
      const custom = new FrameEncoder({ ...defaultCodex, foo });
      const decoded = custom.decode(Uint8Array.from(custom.encode({ id: "f", head: { encoding: "foo" }, data: "bar" })));
      assert.equal(decoded.data, "bar");
    });
  });
});
