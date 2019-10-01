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


@Controller("bar")
class BarController {

  @Get()
  greet() {
    return "hello from bar";
  }

  @Get(":id")
  greetWithId(@Param("id") id: string) {
    return "hello from bar, id: " + id;
  }

  @Use(":id/ray")
  ray = new RayController();
}

@Controller()
class RayController {
  @Get()
  greet(@Param("id") id: string) {
    return "hello from ray, id: " + id;
  }
}

@Controller("foo")
class FooController {
  @Get()
  greet() {
    return "hello from foo";
  }
  @Use()
  bar: BarController;

  constructor(injected: BarController) {
    this.bar = injected;
  }
}

viae.use(
  new App({
    controllers: [new FooController(new BarController())]
  })
)
