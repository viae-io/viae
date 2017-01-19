import { Wire, WireServer } from './wire';
import { Via } from './via';

export class Viae extends Via {
  constructor(protected server: WireServer) {
    super();
    server.on("connection", (wire) => {
      wire.on("close", () => {
        this.clean(wire);
      });
      wire.on("message", (data) => {
        this.decodeWireMessage(wire, new Uint8Array(data));
      });
    });
  }
  private clean(wire: Wire) {
    let interceptors = [];

    for (const item of interceptors) {
    }
    
  }
}