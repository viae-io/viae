import "core-js/modules/es7.symbol.async-iterator";

import { Server as WebSocketServer } from 'ws';
import { Viae, RequestContext, Method } from './src/index';
import { scribe, unhandled } from './src';

let wss = new WebSocketServer({ port: 9090 });
let server = new Viae(wss);

server.route({
  method: Method.GET,
  path: "/echo",
  handlers: [
    (ctx: RequestContext) => {
      ctx.send(ctx.req.body);
    }]
});

server.route({
  method: Method.GET,
  path: "/power",
  handlers: [
    function (ctx: RequestContext) {
      ctx.send({
        "$iterable": {
          [Symbol.asyncIterator]: async function* () {
            for await (let value of ctx.req.body["$iterable"]) {
              if (typeof (value) !== "number")
                throw Error("not a number");
              yield Math.pow(value, 2);
            }
          }
        }
      });
    }]
});

server.use(unhandled());
server.use(scribe());

console.log("Server Running on 9090....");

