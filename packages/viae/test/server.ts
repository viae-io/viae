import { Viae, } from '../src';
import { Server as WebSocketServer } from 'ws';
import { App } from '../src/app';
import { Controller, Get, Data, Param, Post } from '../src/decorators';
import { Subject, isObservable, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ViaeError } from '../src/error';
import { Status } from '@viae/core';

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

@Controller('chat')
class ChatRoomController {
  private _channel = new Subject<string>();

  @Get()
  join() {
    return this._channel;
  }

  @Post()
  addMsg(@Data() msg: string){
    this._channel.next(msg);
    return Status.OK;        
  }
}

viae.use(new App({
  controllers: [new ChatRoomController()]
}));