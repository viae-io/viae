import { Viae, Router, Context, ViaeNext, } from '../../src';
import { Server as WebSocketServer } from 'ws';
import { App } from '../../src/app';
import { Controller, Get, Data, Param, Post, Ctx, Next } from '../../src/decorators';
import { Subject, isObservable, Observable, interval, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { ViaeError } from '../../src/error';
import { Status } from '@viae/core';


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
  @Get("info")
  echo() {
    return interval(50);
  }
}

viae.use(new Router({
  middleware: [
    new App({
       controllers: [new EchoController()]
    })  
  ]
}));