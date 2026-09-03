import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameEncoder, type Frame, defaultCodex } from "../src/codec.js";

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
        5, 114, 101, 113, 45, 49, 25, 185, 0, 2, 102, 109, 101, 116, 104,
        111, 100, 99, 71, 69, 84, 100, 112, 97, 116, 104, 101, 47, 112, 105,
        110, 103, 0,
      ]));
    });

    it("should encode and decode a frame with head only", () => {
      const frame: Frame = { id: "h1", head: { method: "GET", path: "/test" } };
      const buf = Uint8Array.from(encoder.encode(frame));
      const decoded = encoder.decode(buf);
      assert.equal(decoded.id, "h1");
      assert.deepEqual(decoded.head, { method: "GET", path: "/test" });
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
      assert.deepEqual(decoded.head, { status: 200, encoding: "cbor" });
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
        assert.deepEqual(decoded.head, frame.head);
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
        assert.deepEqual(decoded.head, frame.head);
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
});
