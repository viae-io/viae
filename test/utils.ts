import { EventEmitter } from "eventemitter3";
import { createServer, Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { type WireServer, WebSocketWire, Via, Viae } from "../src/index.js";
import type { Log } from "../src/index.js";
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
      const wire = WebSocketWire.wrap(ws as unknown as globalThis.WebSocket);
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

/**
 * Create a connected client via for testing.
 */
export async function createTestClient(port: number, host = "localhost") {
  const ws = new WebSocket(`ws://${host}:${port}`);
  const wire = WebSocketWire.wrap(ws as unknown as globalThis.WebSocket);
  const via = new Via({ wire, log: noopLog });
  await via.ready;
  return { via, ws, wire };
}
