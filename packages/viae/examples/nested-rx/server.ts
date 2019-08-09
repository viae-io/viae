import { Viae, Router, Context, } from '../../src';
import { Server as WebSocketServer } from 'ws';
import { App } from '../../src/app';
import { Controller, Get, Data, Param, Post, Ctx } from '../../src/decorators';
import { Subject, isObservable, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ViaeError } from '../../src/error';
import { Status } from '@viae/core';
import { Next } from 'rowan';

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

@Controller('echo')
class EchoController {
  @Post()
  echo(@Data() data: any, @Ctx() ctx: Context) {
    return data;
  }
}

viae.use(new App({
  controllers: [new EchoController()]
}));
