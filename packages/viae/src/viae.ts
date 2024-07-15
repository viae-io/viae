import { Rowan, Processor, MetaHierarchy } from "rowan";

import { Context } from "./context";
import { WireServer } from "@viae/core";
import { EventEmitter } from "events";

import { Via } from "./via";
import { Log } from "./log";
import { pino } from 'pino';

import { normalisePath } from "./util/normalise";

export class Viae<Ctx extends Context = Context> extends Rowan<Context> {
  private _connections = new Array<Via>();
  private _ev = new EventEmitter();
  private _before = new Rowan<Context>();

  get connections(){
    return [...this._connections]
  }

  constructor(server: WireServer, opts?: { log?: Log, middleware?: Processor<Ctx>[], }) {
    super((opts) ? opts.middleware : undefined);

    this.meta = { type: "Viae" };

    server.on("connection", (wire) => {
      let log = opts && opts.log ? opts.log : Viae.Log;
      let via = new Via({ wire: wire, log: log }).before(this._before).use(this);

      //if (wire.url == undefined && wire["_socket"]) {
      //  (wire as any)["url"] = wire["_socket"]["remoteAddress"]; //+ ":" + wire["_socket"]["remotePort"]
      //}

      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(via), 1);
        log.info(wire.url + " disconnected");
      });

      via.on("error", (err) => {
        log.error(wire.url + " error: " + err.message);
        wire.close();
      });

      this._connections.push(via);
      this._ev.emit("connection", via);
      log.info(wire.url + " connected");
    });
  }

  on(event: "connection", cb: (connection: Via<Ctx>) => void) {
    this._ev.on(event, cb);
  }

  before(processor: Processor<Ctx>) {
    this._before.use(processor);
    return this;
  }

  static Log: Log = pino();

  static extractRoutes(viae: Viae): { method: string, path: string }[] {
    function getRoutes(node: MetaHierarchy, root = ""): { method: string, path: string }[] {
      let routes = [];

      if (node.meta && node.meta.path !== undefined) {
        root = normalisePath(root, node.meta.path);
        if (node.meta.method) {
          routes.push({ method: node.meta.method, path: root });
        }
      }

      if (node.children) {
        for (let child of node.children) {
          routes.push(...getRoutes(child, root));
        }
      }
      return routes;
    }
    return getRoutes(Rowan.hierarchy(viae));
  }
}