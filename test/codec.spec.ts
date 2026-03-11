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
      const decoded = encoder.decode(buf);
      assert.equal(decoded.id, "abc123");
      assert.equal(decoded.head, undefined);
      assert.equal(decoded.data, undefined);
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
