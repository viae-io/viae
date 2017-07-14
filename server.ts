import "core-js/modules/es7.symbol.async-iterator";

import { Server as WebSocketServer } from 'ws';
import { Viae, RequestContext, Method, Router, Subscription, Subscriber } from './src';
import { Scribe, Itable, unhandled } from './src';

let wss = new WebSocketServer({ port: 9090 });
let server = new Viae(wss, new Scribe(), new Itable());
let router = new Router({ root: "/base", name: "example", doc: "An example router" });

router.route({
  method: Method.GET,
  path: "/echo",
  handlers: [
    (ctx) => {
      const req = ctx.req;
      const con = ctx.connection;
      const auth = con.auth;

      if (auth == "john") {
        ctx.send({ body: req.body, status: 200 });
      }
      else {
        ctx.send({ status: 403 });
      }
    }
  ]
});

router.route({
  method: Method.POST,
  path: "/auth",
  handlers: [
    (ctx) => {
      const req = ctx.req;
      const con = ctx.connection;

      con["auth"] = req.body;

      ctx.send({ status: 200 });
    }
  ]
});

server.use(router);
server.use(unhandled());

console.log("Server Running on 9090....");

