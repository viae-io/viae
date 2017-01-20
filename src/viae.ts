import { Wire, WireServer } from './wire';
import { Via } from './via';

export class Viae extends Via {
  private _connections = new Array<Wire>();
  get connections() { return this._connections; };

  constructor(protected server: WireServer) {
    super();

    server.on("connection", (wire) => {
      this._connections.push(wire);
      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(wire), 1);
        this.clean(wire);
      });
      wire.on("message", (data) => {
        this.decodeWireMessage(wire, new Uint8Array(data));
      });
    });
  }

  private clean(wire: Wire) {
    //TODO: clean up interceptors, streamers...    
  }

  broadcast(message) {
    this.send(message, ...this._connections);
  }
}