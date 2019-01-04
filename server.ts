import { Viae, } from './src';
import { Server as WebSocketServer } from 'ws';
import { App } from './src/app';
import { Controller, Get, Data, Param } from './src/decorators';
import { Subject, isObservable, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

let server = new WebSocketServer({ port: 8080, host: "0.0.0.0" });
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

@Controller('api')
class ChatRoomController {
  private _generalChannel = new Subject<string>();

  @Get(":bar")
  general(@Param("bar", Number) bar: number) {
    throw Error("boo");
    return { bar: bar };
  }
}

viae.before(async (ctx, next) => {
  let start = Date.now();

  await next();

  let duration = Date.now() - start;
  if (ctx && ctx.in && ctx.out) {
    let msg = `${ctx.in.head.method} ${ctx.in.head.path} - ${ctx.out.head.status} ${duration.toFixed()}ms`;

    if(ctx.out.head.status >= 500){
      ctx.connection.log.error(msg, ctx.err);
    }else if(ctx.out.head.status >= 400){
      ctx.connection.log.warn(msg);
    }else{
      ctx.connection.log.info(msg);
    }
  }
});

viae.use(new App({
  controllers: [new ChatRoomController()]
}));