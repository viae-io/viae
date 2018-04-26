import { Rowan, Processor } from "rowan";

import { Context } from "./context";
import { WireServer } from "./wire-server";
import { EventEmitter } from "events";

import Via from "./via";

export default class Viae<Ctx extends Context = Context> extends Rowan<Context> {
  private _connections = new Array<Via>();
  private _ev = new EventEmitter();

  constructor(server: WireServer, middleware?: Processor<Ctx>[]) {
    super(middleware);

    server.on("connection", (wire) => {
      let via = new Via(wire).use(this);

      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(via), 1);
      });

      this._connections.push(via);
      this._ev.emit("connection", via);
    });
  }
}