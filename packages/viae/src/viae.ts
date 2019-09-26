import { Rowan, Processor } from "rowan";

import { Context } from "./context";
import { WireServer } from "@viae/core";
import { EventEmitter } from "events";

import { Via } from "./via";
import { Log, ConsoleLog } from "./log";

export class Viae<Ctx extends Context = Context> extends Rowan<Context> {
  private _connections = new Array<Via>();
  private _ev = new EventEmitter();
  private _before = new Rowan<Context>();

  constructor(server: WireServer, opts?: { log?: Log, middleware?: Processor<Ctx>[], }) {
    super((opts) ? opts.middleware : undefined);

    server.on("connection", (wire) => {
      let log = opts && opts.log ? opts.log : Viae.Log;
      let via = new Via({ wire: wire, log: log }).before(this._before).use(this);

      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(via), 1);
        Viae.Log.info("disconnection", ... (via.wire.meta ? [via.wire.meta] : []));
      });

      via.on("error", (err) => {
        wire.close();
      });

      this._connections.push(via);
      this._ev.emit("connection", via);
      log.info("connection", ... (via.wire.meta ? [via.wire.meta] : []));
    });
  }

  on(event: "connection", cb: (connection: Via<Ctx>) => void) {
    this._ev.on(event, cb);
  }

  before(processor: Processor<Ctx>) {
    this._before.use(processor);
    return this;
  }

  static Log: Log = new ConsoleLog();
}