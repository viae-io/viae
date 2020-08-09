import 'web-streams-polyfill';

import { Viae, Router, Context, ViaeNext, } from '../../src';
import { Server as WebSocketServer } from 'ws';
import { App } from '../../src/app';
import { Controller, Get, Data, Param, Post, Ctx, Next } from '../../src/decorators';

let server = new WebSocketServer({
  port: 8080,
  host: "0.0.0.0",
  perMessageDeflate: false
});

let viae = new Viae(server);
let op = 0;

setInterval(() => {
  console.log(`${op} tps`);
  op = 0;
}, 1000);

viae.before((ctx, next) => {
  op += 1;
  return next();
});

@Controller()
class EchoController {
  @Get("echo")
  echo(@Data() data: ReadableStream) {
    return data;
  }
}

viae.use(new Router({
  middleware: [
    new App({
       controllers: [new EchoController()]
    })  
  ]
}));