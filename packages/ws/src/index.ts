import { ConnectableWire, WireState } from '@viae/core';
import { EventEmitter } from 'events';

export type WebSocketConstructor = {
  new(...args: any[]): WebSocket;
};

export class WebSocketWire extends EventEmitter implements ConnectableWire {
  ws?: WebSocket;
  get url(){ 
    if(!this.ws){ return undefined }
    if(this.ws.url) return this.ws.url;
    if(this.ws["_socket"]) return this.ws["_socket"]["remoteAddress"];
  }

  get readyState() { 
    return this.ws ? this.ws.readyState : WireState.CLOSED 
  }

  [index: string]: any;

  constructor(private WS: WebSocketConstructor = WebSocket) {
    super();

    if (WS === undefined) {
      throw Error("WebSocket class is undefined");
    }
  }

  connect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new this.WS(url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        resolve();
        this.emit("open");
      };
      this.ws.onclose = () => {
        reject("connection closed");       
        this.emit("close");
        delete this.ws;
      };

      this.ws.onmessage = (msg) => {
        this.emit("message", msg.data);
      };

      this.ws.onerror = (err) => {
        reject(err);
        this.emit("error", err);
      };
    })

  }

  close(): void {
    if (this.ws === undefined || this.state === "closing")
      return;
    this.emit("closing");
    this.ws.close();
  }

  send(message: ArrayBuffer | ArrayBufferView) {
    if (this.ws === undefined || this.readyState !== WireState.OPEN)
      throw Error("Wire is not open");

    this.ws.send(message);
  }
}