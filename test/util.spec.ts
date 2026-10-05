import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shortId } from "../src/util.js";
import { Status } from "../src/status.js";

describe("shortId", () => {
  it("should return 16 lowercase hex characters", () => {
    assert.match(shortId(), /^[0-9a-f]{16}$/);
  });

  it("should generate 10,000 unique crypto-backed ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = shortId();
      assert.match(id, /^[0-9a-f]{16}$/);
      ids.add(id);
    }
    assert.equal(ids.size, 10_000);
  });

  it("should fall back when the crypto API is unavailable", () => {
    // Node exposes `crypto` as a configurable accessor on globalThis, so it
    // can be replaced and restored.  Restore in `finally` so a failure here
    // cannot leak into other tests.
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    try {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = shortId();
        assert.ok(id.length > 0);
        ids.add(id);
      }
      assert.equal(ids.size, 100);
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });
});

describe("Status", () => {
  it("should expose Busy = 503", () => {
    assert.equal(Status.Busy, 503);
  });
});
