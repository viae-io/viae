import "core-js/modules/es7.symbol.async-iterator";

import { Server } from 'ws';
import { Viae, ViaRequestContext, ViaMethod, Wire } from './src/index';

let wss = new Server({ port: 9090 });
let server = new Viae(wss);

server.route({
  method: ViaMethod.GET,
  path: "/",
  handlers: [(ctx: ViaRequestContext) => {
    ctx.send({ $stream: foo() }, 200);
  }]
});

console.log("Server Running on 9090....");

function* foo() {
  yield 1;
  yield 2;
  yield 3;
}