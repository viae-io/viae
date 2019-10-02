import { Viae, Router, Context, ViaeNext, } from '../../src';
import { Server as WebSocketServer } from 'ws';
import { App } from '../../src/app';
import { Controller, Get, Data, Param, Post, Ctx, Next, Use } from '../../src/decorators';
import { Subject, isObservable, Observable, interval, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { ViaeError } from '../../src/error';
import { Status } from '@viae/core';
import { userInfo } from 'os';
import { get } from 'https';


let server = new WebSocketServer({
  port: 8080,
  host: "0.0.0.0",
  perMessageDeflate: false
});

let viae = new Viae(server);


@Controller("foo")
class FooController {
  @Post("auth")
  async login(@Data() user: string, @Ctx() ctx: Context) { 
    if(user == "foo"){
      ctx.connection.meta.canFoo = true;      
    }else{
      throw new ViaeError(Status.Forbidden, "Access Denied");
    }
  }

  @Get("*")
  async guard(@Next() next, @Ctx() ctx: Context) {
    if(ctx.connection.meta.canFoo !== true){
      throw new ViaeError(Status.Forbidden, "Access Denied");
    }
    return next();
  }

  @Get()
  greetWithId() {
    return "hello from foo";
  }
}

viae.use(
  new App({
    controllers: [new FooController()]
  })
)
