
import { Viae, Wire, WireServer, } from '../src';
import { Server as WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { EventEmitter } from 'events';
import { AddressInfo } from 'net';

type WebSocketServerEvents = {
  "connection": [wire: Wire];
}

export class WebSocketWireServer extends EventEmitter implements WireServer {
  private _server: HttpServer;
  private _wss: WebSocketServer;

  constructor() {
    super();

    const server = new HttpServer();
    const wss = new WebSocketServer({ server });

    this._server = server;
    this._wss = wss;

    this._wss.on("connection", (connection) => {
      this.emit("connection", connection as Wire);
    });
  }

  async listen(port?, host?) {
    return new Promise<AddressInfo>((r, x) => {
      const listeningHandler = () => {
        this._server.off("listening", listeningHandler);
        this._server.off("error", errorHandler);
        r(this._server.address() as AddressInfo);
      }
      const errorHandler = (err) => {
        this._server.off("listening", listeningHandler);
        this._server.off("error", errorHandler);
        x(err);
      }

      this._server.on("listening", listeningHandler);
      this._server.on("error", errorHandler);

      this._server.listen(port, host);
    });
  }

  get address(){
    return this._server.address()
  }

  async close() {
    return new Promise<void>((r, x) => {
      this._server.close((err?) => {
        if (err)
          x(err);
        r();
      })
    })
  }
}

