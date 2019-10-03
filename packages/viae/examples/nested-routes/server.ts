import { Viae, Context } from '../../src';
import { Server as WebSocketServer } from 'ws';
import { App } from '../../src/app';
import { Controller, Get, Param, Ctx, Next, Use, Path, All } from '../../src/decorators';
import { Status } from '@viae/core';



let server = new WebSocketServer({
  port: 8080,
  host: "0.0.0.0",
  perMessageDeflate: false
});

let viae = new Viae(server);


@Controller("bar")
class BarController {
  @Get("*")
  async greet(@Next() next, @Ctx() ctx: Context, @Path() path: string) {
    console.log("BAR:", path);
    await next();
    if (ctx.out.head.status == Status.NotFound) {
      ctx.out.head.status = Status.OK;
      ctx.out.data = "hello from bar";
    } else {
      ctx.out.data = ctx.out.data + " (via bar)"
    }
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

  @All("*")
  guard(@Next() next, @Path() path)
  {
    console.log("FOO:", path);
    return next();
  }

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


console.log(Viae.extractRoutes(viae));