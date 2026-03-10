import { Rowan, type Processor } from "rowan";
import { EventEmitter } from "events";
import type { Wire, WireServer } from "./wire.js";
import type { Context } from "./context.js";
import { Via } from "./via.js";
import type { Log } from "./log.js";
import { consoleLog } from "./log.js";

/**
 * Viae - server that accepts wire connections and creates Via instances.
 * All registered middleware/routers apply to every inbound connection.
 */
export class Viae extends Rowan<Context> {
  private _connections: Via[] = [];
  private _ev = new EventEmitter();
  private _before: Rowan<Context> = new Rowan<Context>();

  static Log: Log = consoleLog;

  get connections(): Via[] {
    return [...this._connections];
  }

  constructor(
    server: WireServer,
    opts?: { log?: Log; middleware?: Processor<Context>[] },
  ) {
    super(opts?.middleware);

    server.on("connection", (wire: Wire) => {
      const log = opts?.log || Viae.Log;

      const via = new Via({ wire, log });
      via.before(this._before);
      via.use(this);

      wire.on("close", () => {
        const idx = this._connections.indexOf(via);
        if (idx >= 0) this._connections.splice(idx, 1);
        log.info(wire.url + " disconnected");
      });

      via.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(wire.url + " error: " + msg);
      });

      this._connections.push(via);
      this._ev.emit("connection", via);
      log.info(wire.url + " connected");
    });
  }

  on(event: "connection", cb: (connection: Via) => void) {
    this._ev.on(event, cb);
  }

  before(processor: Processor<Context>): this {
    this._before.use(processor);
    return this;
  }
}
