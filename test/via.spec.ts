import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "eventemitter3";
import { Via, WireState, type Wire } from "../src/index.js";
import { noopLog } from "./utils.js";

class TestWire extends EventEmitter implements Wire {
  readyState: WireState;
  readonly url = "test://wire";
  sent: ArrayBufferView[] = [];
  closeCalls = 0;

  constructor(readyState = WireState.OPEN) {
    super();
    this.readyState = readyState;
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== WireState.OPEN) throw new Error("wire is not open");
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = WireState.CLOSED;
    this.emit("close");
  }
}

describe("Via connection lifecycle", () => {
  it("should reject a pending request when the wire closes", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });
    const pending = via.request("GET", "/pending");

    wire.emit("close");
    await assert.rejects(pending, /wire closed/);
  });

  it("should reject readiness when a connecting wire closes", async () => {
    const wire = new TestWire(WireState.CONNECTING);
    const via = new Via({ wire, log: noopLog });
    const pending = via.ready;

    wire.emit("close");
    await assert.rejects(pending, /wire closed/);
  });

  it("should close the wire after receiving a malformed frame", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });
    const errors: unknown[] = [];
    via.on("error", error => errors.push(error));

    wire.emit("message", Uint8Array.from([0x80]));

    assert.equal(wire.closeCalls, 1);
    assert.equal(errors.length, 1);
  });
});
