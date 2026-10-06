import { EventEmitter } from "eventemitter3";
import { createServer, Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { type WireServer, WebSocketWire, Via, Viae, WireState } from "../src/index.js";
import type { Log, ViaOptions, Wire } from "../src/index.js";
import type { AddressInfo } from "net";

const noop = () => {};
export const noopLog: Log = {
  trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
};

Via.Log = noopLog;
Viae.Log = noopLog;

/**
 * WebSocket wire server for tests. 
 * Wraps `ws` WebSocketServer + http Server.
 */
export class TestWireServer extends EventEmitter implements WireServer {
  private _server: Server;
  private _wss: InstanceType<typeof WebSocketServer>;

  constructor() {
    super();
    this._server = createServer();
    this._wss = new WebSocketServer({ server: this._server });

    this._wss.on("connection", (ws: WebSocket) => {
      const wire = WebSocketWire.wrap(ws);
      this.emit("connection", wire);
    });
  }

  async listen(port = 0, host = "localhost"): Promise<AddressInfo> {
    return new Promise<AddressInfo>((resolve, reject) => {
      this._server.on("listening", () => {
        resolve(this._server.address() as AddressInfo);
      });
      this._server.on("error", reject);
      this._server.listen(port, host);
    });
  }

  async close(): Promise<void> {
    this._wss.close();
    return new Promise<void>((resolve, reject) => {
      this._server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

/** Client-side `Via` options (the wire is supplied by the helper). */
export type TestClientOptions = Omit<ViaOptions, "wire">;

/**
 * Create a connected client via for testing.
 *
 * `opts` is optional and backward compatible: the wire and default noop log
 * are supplied here, everything else is forwarded to the `Via` constructor.
 */
export async function createTestClient(
  port: number,
  host = "localhost",
  opts: TestClientOptions = {},
) {
  const ws = new WebSocket(`ws://${host}:${port}`);
  const wire = WebSocketWire.wrap(ws);
  const via = new Via({ ...opts, wire, log: opts.log ?? noopLog });
  await via.ready;
  return { via, ws, wire };
}

/**
 * Close a wire and wait until its `"close"` event fires. Bounded so a stuck
 * socket fails the test explicitly instead of hanging it; a wire that is
 * already closed resolves immediately.
 */
export function closeAndWait(wire: Wire, timeoutMs = 2000): Promise<void> {
  if (wire.readyState === WireState.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClose = () => {
      clearTimeout(timer);
      wire.off("close", onClose);
      resolve();
    };
    timer = setTimeout(() => {
      wire.off("close", onClose);
      reject(new Error(`wire did not emit close within ${timeoutMs}ms`));
    }, timeoutMs);
    wire.on("close", onClose);
    try {
      wire.close();
    } catch (err) {
      clearTimeout(timer);
      wire.off("close", onClose);
      reject(err);
    }
  });
}
