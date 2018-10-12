import { Rowan, Processor } from "rowan";

import { Context } from "./context";
import { WireServer } from "./wire-server";
import { EventEmitter } from "events";

import Via from "./via";
import { ILogger, ConsoleLogger } from "./log";

export default class Viae<Ctx extends Context = Context> extends Rowan<Context> {
  private _connections = new Array<Via>();
  private _ev = new EventEmitter();
  private _before = new Rowan<Context>();

  constructor(server: WireServer, middleware?: Processor<Ctx>[]) {
    super(middleware);

    server.on("connection", (wire) => {
      let via = new Via(wire, { log: Viae.Log }).before(this._before).use(this);

      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(via), 1);
      });

      via.on("error", (err) => {
        console.log("connection error", err);
        wire.close();
      });

      this._connections.push(via);
      this._ev.emit("connection", via);
    });
  }

  on(event: "connection", cb: (connection: Via<Ctx>) => void) {
    this._ev.on(event, cb);
  }

  before(processor: Processor<Ctx>) {
    this._before.use(processor);
    return this;
  }

  static Log: ILogger = new ConsoleLogger();
}