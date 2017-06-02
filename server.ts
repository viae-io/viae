import "core-js/modules/es7.symbol.async-iterator";

import { Server } from 'ws';
import { Viae, ViaRequestContext, ViaMethod, Wire } from './src/index';

let wss = new Server({ port: 9090 });
let server = new Viae(wss);

function* foo() {
  yield 1;
  yield "hello world";
  yield new Uint8Array([1, 2, 3, 4]);
  yield { name: "john", age: 50 }
}

server.route({
  method: ViaMethod.GET,
  path: "/",
  handlers: [(ctx: ViaRequestContext) => {
    ctx.send({ $stream: { [Symbol.iterator]: foo } }, 200);
  }]
});

console.log("Server Running on 9090....");

