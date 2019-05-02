import { ConnectibleWire } from '@viae/core';
import { EventEmitter } from 'events';

export type WebSocketConstructor = {
  new(...args: any[]): WebSocket;
};

export class WebSocketWire extends EventEmitter implements ConnectibleWire {
  ws?: WebSocket;
  state: "opening" | "open" | "closing" | "closed";
  [index: string]: any;

  constructor(private WS: WebSocketConstructor = WebSocket) {
    super();

    if (WS === undefined) {
      throw Error("WebSocket class is undefined");
    }
  }

  connect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.state = "opening";

      this.ws = new this.WS(url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        resolve();
        this.state = "open";
        this.emit("open");
      };

      this.ws.onclose = () => {
        reject("connection closed");
        this.state = "closed";
        this.emit("close");
        delete this.ws;
      };

      this.ws.onmessage = (msg) => {
        this.emit("message", msg.data);
      };

      this.ws.onerror = (err) => {
        reject(err);
        this.state = "closed";
        this.emit("error", err);
      };
    })

  }

  close(): void {
    if (this.ws === undefined || this.state === "closing")
      return;

    this.state = "closing";
    this.emit("closing");
    this.ws.close();
  }

  send(message: ArrayBuffer | ArrayBufferView) {
    if (this.ws === undefined || this.state !== "open")
      throw Error("Wire is not open");

    this.ws.send(message);
  }
}