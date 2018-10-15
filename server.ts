import { Viae } from './src';
import { Server as WebSocketServer } from 'ws';
import { App } from './src/app';
import { Controller, Get, Data, Param, All, Next, Ctx, Raw, Head } from './src/decorators';
import { Middleware } from 'rowan';
import { Observable, from, isObservable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ftruncate } from 'fs';


let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

@Controller('chat')
class ChatRoomController {
  @Get("echo")
  general(@Data() data) {
    if (isObservable(data)) {
      return data.pipe(map(x => {
        if (typeof x != "number")
          throw Error("Not a number");
        return x * 2;
      }));
    }
  }
}

viae.before(async (ctx, next) => {
  let start = Date.now();

  await next();

  let duration = Date.now() - start;
  if (ctx && ctx.in && ctx.out) {
    ctx.connection.log.info(`${ctx.in.head.method} ${ctx.in.head.path} - ${ctx.out.head.status} ${duration.toFixed()}ms`);
  }
});

viae.use(new App({
  controllers: [new ChatRoomController()]
}));