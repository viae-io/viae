import { Viae, Status } from './src';
import { Server as WebSocketServer } from 'ws';
import { App } from './src/app';
import { Controller, Get, Data, Param, All, Next, Ctx, Raw, Head, Put } from './src/decorators';
import { Middleware } from 'rowan';
import { Observable, from, isObservable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { ftruncate } from 'fs';


let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

@Controller('chat')
class ChatRoomController {
  private _generalChannel = new Subject<string>();

  @Get("channel")
  general() {
    return this._generalChannel;
  }

  @Put("message")
  generalMessage(@Data() data: string) {
    this._generalChannel.next(data);
    return Status.OK;
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