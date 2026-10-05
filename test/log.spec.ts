import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { consoleLog, makeLogFn } from "../src/log.js";

describe("log", () => {
  it("should forward string messages with trailing args", () => {
    const calls: unknown[][] = [];
    const fn = makeLogFn((...args) => calls.push(args));

    fn("hello", 1, "two");

    assert.deepEqual(calls, [["hello", 1, "two"]]);
  });

  it("should reorder object-first calls to message-first", () => {
    const calls: unknown[][] = [];
    const fn = makeLogFn((...args) => calls.push(args));

    fn({ a: 1 }, "context", 2);

    assert.deepEqual(calls, [["context", { a: 1 }, 2]]);
  });

  it("should default the message to an empty string for object-only calls", () => {
    const calls: unknown[][] = [];
    const fn = makeLogFn((...args) => calls.push(args));

    fn({ a: 1 });

    assert.deepEqual(calls, [["", { a: 1 }]]);
  });

  it("should expose the six console-backed log functions", () => {
    for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
      assert.equal(typeof consoleLog[level], "function", `${level} must be a function`);
    }
  });
});
