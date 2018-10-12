import { Viae } from './src';
import { Server as WebSocketServer } from 'ws';
import { App } from './src/app';
import { Controller, Get, Data, Param, All, Next, Ctx, Raw, Head } from './src/decorators';
import { Middleware } from 'rowan';
import { Observable, from, isObservable } from 'rxjs';
import { map } from 'rxjs/operators';

let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

server.on("connection", (via) => {
  console.log("client connected");
  via.on("close", () => {
    console.log("client disconnected");
  });
});

server.on("error", (error) => {
  console.log("connection error");
});

@Controller('chat')
class ChatRoomController {
  @Get("echo")
  general(@Data() data) {
    if(isObservable(data)){
      return data.pipe(map(x=>{
        if(typeof x != "number") 
          throw Error("Not a number");
        return x * 2;
      }))
    }    
  }
}

viae.use(new App({
  controllers: [new ChatRoomController()]
}));