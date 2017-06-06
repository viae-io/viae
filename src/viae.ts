import { Wire, WireServer } from './wire';
import { Via, ViaHandler } from './via';
import { Method } from './method';
import { PathRequest, requestPath, requestMethod } from './middleware';

export class Viae extends Via {
  private _connections = new Array<Wire>();
  get connections() { return this._connections; };

  constructor(protected server: WireServer) {
    super();

    server.on("connection", (wire) => {
      this._connections.push(wire);
      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(wire), 1);
      });
      wire.on("message", (data) => {
        this.deserialiseMessage(data, wire);
      });
    });    
  }


  route(opts: {
    path: string,
    method: Method,
    handlers: ViaHandler[]
  }) {
    this.use(
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}