import { Viae, Router, Context, ViaeNext, Via, Message, } from '../../src';
import { Server as WebSocketServer } from 'ws';
import { App } from '../../src/app';
import { Controller, Get, Data, Param, Post, Ctx, Next, All } from '../../src/decorators';


let server = new WebSocketServer({ port: 8080, host: "0.0.0.0" });
let viae = new Viae(server);

@Controller()
class EchoController {

  @All("*")
  async echo(@Ctx() ctx: Context) {
    let method = ctx.in.head.method;
    let path = ctx.in.head.path;
    let data = ctx.in.data;
    let target = ctx.connection as Via;
    return target.call(method, path, data);
  }
}

viae.use(new Router({
  middleware: [
    new App({
      controllers: [new EchoController()]
    })
  ]
}));